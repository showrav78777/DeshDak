import "server-only";
import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { authorizePrivatePhotoAdmin } from "./quarantine";
import { parsePrivatePhotoReference, type createPrivatePhotoStore } from "./photos";
import { normalizePrivatePhoto } from "./photo-processing";
import type { PrivatePhotoScanProof } from "./photo-scanner";

export const privatePhotoRescanRequest = z.object({ expectedSequence: z.number().int().positive().max(1_000_000), blockedConfirmed: z.literal(true), idempotencyKey: z.uuid() }).strict();
export class PrivatePhotoRescanError extends Error {
  constructor(code: "PRIVATE_RESCAN_DENIED" | "PRIVATE_RESCAN_CONFLICT" | "PRIVATE_RESCAN_UNAVAILABLE") { super(code); }
}
type Request = Prisma.PrivatePhotoRescanGetPayload<{ include: { result: true } }>;
export function privatePhotoRescanDto(row: Request) {
  return { id: row.id, state: row.result?.state ?? (row.deadlineAt <= new Date() ? "EXPIRED" : "PENDING"), createdAt: row.createdAt, completedAt: row.result?.completedAt ?? null, scope: "STORED_PHOTO" as const, quarantined: true as const };
}
function sameReference(left: unknown, right: unknown) {
  return JSON.stringify(parsePrivatePhotoReference(left)) === JSON.stringify(parsePrivatePhotoReference(right));
}

/** This administrative scanner reads bytes internally; it never delivers or releases a file. */
export function createPrivatePhotoRescanner(db: PrismaClient, store: Pick<ReturnType<typeof createPrivatePhotoStore>, "namespace" | "read">, scan: (bytes: Buffer) => Promise<PrivatePhotoScanProof>) {
  if (!/^[a-f0-9]{64}$/.test(store.namespace)) throw new PrivatePhotoRescanError("PRIVATE_RESCAN_UNAVAILABLE");
  async function run(sessionId: string, uploadId: string, raw: z.input<typeof privatePhotoRescanRequest>) {
    z.uuid().parse(sessionId); z.uuid().parse(uploadId); const input = privatePhotoRescanRequest.parse(raw);
    const prepared = await db.$transaction(async tx => {
      const actorId = await authorizePrivatePhotoAdmin(tx, sessionId);
      await tx.$queryRaw`SELECT "id" FROM "PrivatePhotoUpload" WHERE "id" = ${uploadId} FOR UPDATE`;
      const previous = await tx.privatePhotoRescan.findUnique({ where: { actorId_idempotencyKey: { actorId, idempotencyKey: input.idempotencyKey } }, include: { result: true, review: { select: { sequence: true } } } });
      if (previous) {
        if (previous.uploadId !== uploadId || previous.review.sequence !== input.expectedSequence) throw new PrivatePhotoRescanError("PRIVATE_RESCAN_CONFLICT");
        return { fresh: false, row: previous };
      }
      const upload = await tx.privatePhotoUpload.findUnique({ where: { id: uploadId }, include: { quarantine: true } });
      if (!upload?.quarantine || upload.status !== "STORED" || upload.storageNamespace !== store.namespace) throw new PrivatePhotoRescanError("PRIVATE_RESCAN_DENIED");
      const reference = parsePrivatePhotoReference(upload.storedReference);
      if (reference.purpose !== upload.purpose || !upload.originalScanVerifiedAt || !/^[a-f0-9]{64}$/.test(upload.originalScanSha256 ?? "") || !upload.scanVerifiedAt || upload.scanVerifiedSha256 !== reference.plaintextSha256 || upload.originalScanVerifiedAt > upload.scanVerifiedAt || upload.scanVerifiedAt < upload.createdAt || upload.scanVerifiedAt.getTime() > Date.now() + 300_000) throw new PrivatePhotoRescanError("PRIVATE_RESCAN_DENIED");
      const review = await tx.privatePhotoQuarantineReview.findFirst({ where: { quarantineId: upload.quarantine.id }, orderBy: { sequence: "desc" } });
      if (!review || review.sequence !== input.expectedSequence || review.decision !== "RESCAN_REQUIRED") throw new PrivatePhotoRescanError("PRIVATE_RESCAN_CONFLICT");
      const now = new Date();
      const [usedReview, pending, count] = await Promise.all([
        tx.privatePhotoRescan.findUnique({ where: { reviewId: review.id }, select: { id: true } }),
        tx.privatePhotoRescan.findFirst({ where: { uploadId, deadlineAt: { gt: now }, result: { is: null } }, select: { id: true } }),
        tx.privatePhotoRescan.count({ where: { uploadId, createdAt: { gt: new Date(now.getTime() - 86_400_000) } } }),
      ]);
      if (usedReview || pending || count >= 5) throw new PrivatePhotoRescanError("PRIVATE_RESCAN_CONFLICT");
      const row = await tx.privatePhotoRescan.create({ data: { actorId, uploadId, quarantineId: upload.quarantine.id, reviewId: review.id, idempotencyKey: input.idempotencyKey, storageNamespace: store.namespace, referenceSnapshot: reference, deadlineAt: new Date(now.getTime() + 60_000) }, include: { result: true } });
      await tx.auditLog.create({ data: { actorId, action: "private_photo.rescan_requested", entityType: "PrivatePhotoRescan", entityId: row.id, metadata: { reviewSequence: review.sequence, scope: "STORED_PHOTO" } } });
      return { fresh: true, row };
    });
    if (!prepared.fresh) return privatePhotoRescanDto(prepared.row);
    const request = prepared.row;
    try {
      const reference = parsePrivatePhotoReference(request.referenceSnapshot);
      const bytes = await store.read(reference);
      if (bytes.length !== reference.sizeBytes || createHash("sha256").update(bytes).digest("hex") !== reference.plaintextSha256) throw new Error("Unconfirmed stored photo");
      const proof = await scan(Buffer.from(bytes));
      if (proof?.sha256 !== reference.plaintextSha256 || !(proof.verifiedAt instanceof Date) || !Number.isFinite(proof.verifiedAt.getTime()) || proof.verifiedAt < request.createdAt || proof.verifiedAt.getTime() > Date.now() || Date.now() - proof.verifiedAt.getTime() > 60_000) throw new Error("Unconfirmed scan");
      // Scan before decoding a potentially suspect image; never alter the scan target.
      await normalizePrivatePhoto(bytes, reference.mimeType, reference.purpose);
      const row = await db.$transaction(async tx => {
        const actorId = await authorizePrivatePhotoAdmin(tx, sessionId);
        await tx.$queryRaw`SELECT "id" FROM "PrivatePhotoUpload" WHERE "id" = ${uploadId} FOR UPDATE`;
        const upload = await tx.privatePhotoUpload.findUnique({ where: { id: uploadId }, include: { quarantine: true } });
        const latest = await tx.privatePhotoQuarantineReview.findFirst({ where: { quarantineId: request.quarantineId }, orderBy: { sequence: "desc" }, select: { id: true } });
        if (actorId !== request.actorId || request.deadlineAt <= new Date() || upload?.quarantine?.id !== request.quarantineId || upload.status !== "STORED" || upload.storageNamespace !== store.namespace || !sameReference(upload.storedReference, request.referenceSnapshot) || latest?.id !== request.reviewId) throw new Error("Changed rescan context");
        await tx.privatePhotoRescanResult.create({ data: { rescanId: request.id, state: "CLEAN", sha256: proof.sha256, verifiedAt: proof.verifiedAt } });
        await tx.auditLog.create({ data: { actorId, action: "private_photo.rescan_completed", entityType: "PrivatePhotoRescan", entityId: request.id, metadata: { state: "CLEAN", scope: "STORED_PHOTO" } } });
        return tx.privatePhotoRescan.findUniqueOrThrow({ where: { id: request.id }, include: { result: true } });
      });
      return privatePhotoRescanDto(row);
    } catch {
      // A prior authorized request may record failure even if its session was revoked.
      // This never grants clean proof, new access or permission to retry provider I/O.
      const row = await db.$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "PrivatePhotoUpload" WHERE "id" = ${uploadId} FOR UPDATE`;
        const current = await tx.privatePhotoRescan.findUniqueOrThrow({ where: { id: request.id }, include: { result: true } });
        if (current.result) return current;
        await tx.privatePhotoRescanResult.create({ data: { rescanId: request.id, state: "UNCONFIRMED" } });
        await tx.auditLog.create({ data: { actorId: request.actorId, action: "private_photo.rescan_completed", entityType: "PrivatePhotoRescan", entityId: request.id, metadata: { state: "UNCONFIRMED", scope: "STORED_PHOTO" } } });
        return tx.privatePhotoRescan.findUniqueOrThrow({ where: { id: request.id }, include: { result: true } });
      });
      await db.$transaction(tx => authorizePrivatePhotoAdmin(tx, sessionId));
      return privatePhotoRescanDto(row);
    }
  }
  return { rescan: async (sessionId: string, uploadId: string, raw: z.input<typeof privatePhotoRescanRequest>) => {
    try { return await run(sessionId, uploadId, raw); }
    catch (error) {
      try {
        const session = z.uuid().safeParse(sessionId).success ? await db.authSession.findUnique({ where: { id: sessionId }, select: { userId: true } }) : null;
        await db.auditLog.create({ data: { actorId: session?.userId, action: "private_photo.rescan_blocked", entityType: "PrivatePhotoRescan", metadata: { outcome: error instanceof PrivatePhotoRescanError ? error.message : "unavailable" } } });
      } catch { throw new PrivatePhotoRescanError("PRIVATE_RESCAN_UNAVAILABLE"); }
      if (error instanceof PrivatePhotoRescanError) throw error;
      if (error instanceof Error && error.message === "PHOTO_QUARANTINE_DENIED") throw new PrivatePhotoRescanError("PRIVATE_RESCAN_DENIED");
      throw new PrivatePhotoRescanError("PRIVATE_RESCAN_UNAVAILABLE");
    }
  } };
}
