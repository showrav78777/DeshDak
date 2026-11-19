import "server-only";
import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { createPrivatePhotoStore } from "./photos";
import type { PrivatePhotoScanProof } from "./photo-scanner";
import { normalizePrivatePhoto } from "./photo-processing";
import { createPrivateUploadLedger } from "./upload-ledger";

function digest(bytes: Buffer) { return createHash("sha256").update(bytes).digest("hex"); }
function verifyProof(proof: PrivatePhotoScanProof, bytes: Buffer) {
  if (proof?.sha256 !== digest(bytes) || !(proof.verifiedAt instanceof Date) || !Number.isFinite(proof.verifiedAt.getTime()) || proof.verifiedAt.getTime() > Date.now() || Date.now()-proof.verifiedAt.getTime() > 60_000) throw new Error("PRIVATE_PHOTO_INTAKE_FAILED");
}

/** Scan both original and normalized bytes before storing; callers enforce session authorization. */
export function createScannedPrivateIntake(db: PrismaClient, store: ReturnType<typeof createPrivatePhotoStore>, scan: (bytes: Buffer) => Promise<PrivatePhotoScanProof>) {
  const ledger = createPrivateUploadLedger(db,store);
  return { intake: async (input: { actorId: string; purpose: "identity" | "inspection"; idempotencyKey: string; file: File }) => {
    try {
      if (typeof input.idempotencyKey !== "string" || !/^[A-Za-z0-9:_-]{16,128}$/.test(input.idempotencyKey) || !(input.file instanceof File) || !["identity","inspection"].includes(input.purpose) || !input.file.size || input.file.size > (input.purpose === "identity" ? 5 : 8)*1024*1024 || !["image/jpeg","image/png","image/webp"].includes(input.file.type)) throw new Error("Invalid input");
      const actor = await db.user.findUnique({ where: { id: input.actorId }, select: { status: true, deletedAt: true } });
      if (actor?.status !== "ACTIVE" || actor.deletedAt) throw new Error("Inactive actor");
      const original = Buffer.from(await input.file.arrayBuffer());
      if (original.length !== input.file.size) throw new Error("Invalid photo size");
      const originalProof = await scan(Buffer.from(original)); verifyProof(originalProof,original);
      const normalized = await normalizePrivatePhoto(original,input.file.type,input.purpose);
      const normalizedProof = await scan(Buffer.from(normalized)); verifyProof(normalizedProof,normalized);
      const stored = await ledger.storePhoto({ actorId: input.actorId, purpose: input.purpose, idempotencyKey: input.idempotencyKey, bytes: normalized, mimeType: input.file.type as "image/jpeg" | "image/png" | "image/webp" });
      if (stored.state !== "STORED") return { state: stored.state, uploadId: stored.uploadId };
      await db.$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${input.actorId} FOR NO KEY UPDATE`;
        const currentActor = await tx.user.findUnique({ where: { id: input.actorId }, select: { status: true, deletedAt: true } });
        if (currentActor?.status !== "ACTIVE" || currentActor.deletedAt) throw new Error("Inactive actor");
        await tx.$queryRaw`SELECT "id" FROM "PrivatePhotoUpload" WHERE "id" = ${stored.uploadId} FOR UPDATE`;
        const row = await tx.privatePhotoUpload.findUniqueOrThrow({ where: { id: stored.uploadId }, include: { quarantine: true } });
        if (row.quarantine || row.actorId !== input.actorId || row.status !== "STORED" || row.storageNamespace !== store.namespace || stored.reference.plaintextSha256 !== normalizedProof.sha256) throw new Error("Unconfirmed photo");
        if (row.originalScanSha256 || row.scanVerifiedSha256) {
          if (row.originalScanSha256 !== originalProof.sha256 || row.scanVerifiedSha256 !== normalizedProof.sha256 || !row.originalScanVerifiedAt || !row.scanVerifiedAt) throw new Error("PRIVATE_PHOTO_SCAN_CONFLICT");
          return;
        }
        // Record both verified attestations against the database clock. Mixing the
        // application clock with timestamp(3) creation times can invert chronology.
        const [clock] = await tx.$queryRaw<Array<{ recordedAt: Date }>>`SELECT clock_timestamp()::timestamp(3) AS "recordedAt"`;
        const recordedAt = new Date(Math.max(clock.recordedAt.getTime(), row.createdAt.getTime()));
        await tx.privatePhotoUpload.update({ where: { id: row.id }, data: { originalScanSha256: originalProof.sha256, originalScanVerifiedAt: recordedAt, scanVerifiedSha256: normalizedProof.sha256, scanVerifiedAt: recordedAt } });
        await tx.auditLog.create({ data: { actorId: input.actorId, action: "private_photo.scan_verified", entityType: "PrivatePhotoUpload", entityId: row.id, metadata: { purpose: input.purpose, policy: "private-image-v1" } } });
      });
      return { state: "STORED" as const, uploadId: stored.uploadId };
    } catch { throw new Error("PRIVATE_PHOTO_INTAKE_FAILED"); }
  } };
}
