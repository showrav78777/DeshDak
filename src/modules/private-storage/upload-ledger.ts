import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { createPrivatePhotoStore, PreparedPrivatePhoto, PrivatePhotoReference } from "./photos";

type Store = ReturnType<typeof createPrivatePhotoStore>;
type Result = { state: "STORED"; uploadId: string; reference: PrivatePhotoReference } | { state: "BUSY" | "REVIEW_REQUIRED"; uploadId: string };
const schema = z.object({ actorId: z.uuid(), purpose: z.enum(["identity","inspection"]), idempotencyKey: z.string().min(16).max(128).regex(/^[A-Za-z0-9:_-]+$/), mimeType: z.enum(["image/jpeg","image/png","image/webp"]) });
export class PrivateUploadLedgerError extends Error {
  constructor(publicCode: "PRIVATE_UPLOAD_CONFLICT" | "PRIVATE_UPLOAD_UNAVAILABLE") { super(publicCode); }
}

/** Internal staging component: callers must authorize and scan normalized photos. */
export function createPrivateUploadLedger(db: PrismaClient, store: Store) {
  async function storePhoto(input: { actorId: string; purpose: "identity" | "inspection"; idempotencyKey: string; mimeType: PrivatePhotoReference["mimeType"]; bytes: Buffer }): Promise<Result> {
    const parsed = schema.safeParse(input);
    if (!parsed.success || !Buffer.isBuffer(input.bytes) || !input.bytes.length || input.bytes.length > (input.purpose === "identity" ? 5 : 8) * 1024 * 1024) throw new PrivateUploadLedgerError("PRIVATE_UPLOAD_UNAVAILABLE");
    const data = parsed.data;
    const fingerprint = createHash("sha256").update(`deshdak:photo-upload:v1:${data.purpose}:${data.mimeType}:`).update(input.bytes).digest("hex");
    const row = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${data.actorId} FOR UPDATE`;
      const actor = await tx.user.findUnique({ where: { id: data.actorId }, select: { status: true, deletedAt: true } });
      if (actor?.status !== "ACTIVE" || actor.deletedAt) throw new PrivateUploadLedgerError("PRIVATE_UPLOAD_UNAVAILABLE");
      const existing = await tx.privatePhotoUpload.findUnique({ where: { actorId_idempotencyKey: { actorId: data.actorId, idempotencyKey: data.idempotencyKey } } });
      if (existing) {
        if (existing.fingerprint !== fingerprint || existing.storageNamespace !== store.namespace) throw new PrivateUploadLedgerError("PRIVATE_UPLOAD_CONFLICT");
        return existing;
      }
      const prepared = store.prepare(data.purpose,input.bytes,data.mimeType);
      const created = await tx.privatePhotoUpload.create({ data: { actorId: data.actorId, purpose: data.purpose, idempotencyKey: data.idempotencyKey, fingerprint, storageNamespace: store.namespace, preparedReference: prepared.reference, encryptedBody: prepared.encryptedBody } });
      await tx.auditLog.create({ data: { actorId: data.actorId, action: "private_photo.prepared", entityType: "PrivatePhotoUpload", entityId: created.id, metadata: { purpose: data.purpose } } });
      return created;
    });
    if (await db.privatePhotoQuarantine.findUnique({ where: { uploadId: row.id }, select: { id: true } })) return { state: "REVIEW_REQUIRED", uploadId: row.id };
    if (row.status === "STORED") return { state: "STORED", uploadId: row.id, reference: row.storedReference as unknown as PrivatePhotoReference };
    if (row.attempts >= 5) return { state: "REVIEW_REQUIRED", uploadId: row.id };
    const leaseToken = randomUUID(); const now = new Date();
    const claimed = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "PrivatePhotoUpload" WHERE "id" = ${row.id} FOR UPDATE`;
      if (await tx.privatePhotoQuarantine.findUnique({ where: { uploadId: row.id }, select: { id: true } })) return { count: 0 };
      return tx.privatePhotoUpload.updateMany({ where: { id: row.id, quarantine: { is: null }, attempts: row.attempts, status: { in: ["PREPARED","REVIEW_REQUIRED"] }, OR: [{ leaseExpiresAt: null },{ leaseExpiresAt: { lte: now } }] }, data: { leaseToken, leaseExpiresAt: new Date(now.getTime()+60_000), attempts: { increment: 1 } } });
    });
    if (!claimed.count) return { state: "BUSY", uploadId: row.id };
    const lease = { id: row.id, leaseToken, status: { in: ["PREPARED","REVIEW_REQUIRED"] } };
    let reference: PrivatePhotoReference | undefined;
    try {
      if (!row.encryptedBody) throw new PrivateUploadLedgerError("PRIVATE_UPLOAD_UNAVAILABLE");
      const prepared = { reference: row.preparedReference, encryptedBody: Buffer.from(row.encryptedBody) } as PreparedPrivatePhoto;
      // Any later attempt verifies the first write instead of issuing another PUT.
      reference = row.attempts ? await store.confirm(prepared) : await store.write(prepared);
      const verified = await store.read(reference);
      const received = createHash("sha256").update(`deshdak:photo-upload:v1:${data.purpose}:${data.mimeType}:`).update(verified).digest("hex");
      if (received !== fingerprint) throw new PrivateUploadLedgerError("PRIVATE_UPLOAD_UNAVAILABLE");
      const stored = await db.$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "PrivatePhotoUpload" WHERE "id" = ${row.id} FOR UPDATE`;
        if (await tx.privatePhotoQuarantine.findUnique({ where: { uploadId: row.id }, select: { id: true } })) return false;
        const actor = await tx.user.findUnique({ where: { id: data.actorId }, select: { status: true, deletedAt: true } });
        if (actor?.status !== "ACTIVE" || actor.deletedAt) return false;
        const changed = await tx.privatePhotoUpload.updateMany({ where: { ...lease, quarantine: { is: null } }, data: { status: "STORED", storedReference: reference, encryptedBody: null, leaseToken: null, leaseExpiresAt: null } });
        if (!changed.count) return false;
        await tx.auditLog.create({ data: { actorId: data.actorId, action: "private_photo.stored", entityType: "PrivatePhotoUpload", entityId: row.id, metadata: { purpose: data.purpose } } });
        return true;
      });
      if (stored) return { state: "STORED", uploadId: row.id, reference };
    } catch { /* Preserve a durable review record; never retry an unknown PUT. */ }
    const review = await db.$transaction(async tx => {
      const changed = await tx.privatePhotoUpload.updateMany({ where: lease, data: { status: "REVIEW_REQUIRED", ...(reference ? { storedReference: reference } : {}), leaseToken: null, leaseExpiresAt: null } });
      if (changed.count) await tx.auditLog.create({ data: { actorId: data.actorId, action: "private_photo.review_required", entityType: "PrivatePhotoUpload", entityId: row.id, metadata: { purpose: data.purpose } } });
      return changed.count;
    });
    return { state: review ? "REVIEW_REQUIRED" : "BUSY", uploadId: row.id };
  }
  return { storePhoto: async (input: Parameters<typeof storePhoto>[0]) => {
    try { return await storePhoto(input); }
    catch (error) {
      if (error instanceof PrivateUploadLedgerError) throw error;
      throw new PrivateUploadLedgerError("PRIVATE_UPLOAD_UNAVAILABLE");
    }
  } };
}
