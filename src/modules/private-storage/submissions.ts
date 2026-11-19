import "server-only";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Prisma, PrismaClient } from "@prisma/client";
import { createScannedPrivateIntake } from "./scanned-intake";
import { createPrivatePhotoLinks } from "./record-links";
import { parsePrivatePhotoReference } from "./photos";
import { authorizePrivateUpload } from "./upload-authorization";
import type { privatePhotoRuntime } from "./runtime";

type Runtime = NonNullable<ReturnType<typeof privatePhotoRuntime>>;
type IdentityDetails = { documentType: "NATIONAL_ID" | "PASSPORT" | "DRIVING_LICENSE"; issuingCountryCode: string; documentNumberLast4: string };
type Submission = { kind: "identity"; details: IdentityDetails } | { kind: "inspection"; packageId: string };

type SubmissionErrorCode = "PRIVATE_PHOTO_ACCESS_CHANGED" | "PRIVATE_PHOTO_ALREADY_VERIFIED" | "PRIVATE_PHOTO_REVIEW_REQUIRED" | "PRIVATE_PHOTO_UNAVAILABLE" | "PRIVATE_PHOTO_CONFLICT";
export class PrivatePhotoSubmissionError extends Error {
  readonly code: SubmissionErrorCode;
  constructor(code: SubmissionErrorCode) { super(code); this.code = code; }
}

/** Scan and store outside database locks, then atomically commit the subject and binding. */
export function createPrivatePhotoSubmissions(db: PrismaClient, runtime: Runtime) {
  const intake = createScannedPrivateIntake(db, runtime.store, runtime.scan);
  const links = createPrivatePhotoLinks(db, runtime.store.namespace);
  return {
    async submit(input: Submission & { actorId: string; sessionId: string; requestKey: string; file: File }) {
      if (!/^[a-zA-Z0-9:_-]{16,128}$/.test(input.requestKey)) throw new PrivatePhotoSubmissionError("PRIVATE_PHOTO_UNAVAILABLE");
      const authorization = { userId: input.actorId, sessionId: input.sessionId, kind: input.kind, ...(input.kind === "inspection" ? { packageId: input.packageId } : {}) };
      if (!await db.$transaction(tx => authorizePrivateUpload(tx, authorization))) throw new PrivatePhotoSubmissionError("PRIVATE_PHOTO_ACCESS_CHANGED");
      const scope = input.kind === "identity" ? input.details : { packageId: input.packageId };
      const idempotencyKey = createHash("sha256").update(JSON.stringify([input.kind, input.requestKey])).digest("hex");
      const stored = await intake.intake({ actorId: input.actorId, purpose: input.kind, idempotencyKey, file: input.file });
      if (stored.state !== "STORED") throw new PrivatePhotoSubmissionError("PRIVATE_PHOTO_REVIEW_REQUIRED");
      const result = await db.$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${input.actorId} FOR NO KEY UPDATE`;
        await tx.$queryRaw`SELECT "id" FROM "PrivatePhotoUpload" WHERE "id" = ${stored.uploadId} FOR UPDATE`;
        if (!await authorizePrivateUpload(tx, authorization)) return null;
        const upload = await tx.privatePhotoUpload.findUniqueOrThrow({ where: { id: stored.uploadId } });
        if (upload.submissionScope && !isDeepStrictEqual(upload.submissionScope, scope)) throw new PrivatePhotoSubmissionError("PRIVATE_PHOTO_CONFLICT");
        if (!upload.submissionScope) await tx.privatePhotoUpload.update({ where: { id: upload.id }, data: { submissionScope: scope } });
        const reference = parsePrivatePhotoReference(upload.storedReference);
        const existing = await tx.privatePhotoLink.findUnique({ where: { uploadId: stored.uploadId } });
        if (existing) {
          const subjectId = input.kind === "identity" ? existing.identityVerificationId : existing.inspectionEvidenceId;
          if (!subjectId) throw new PrivatePhotoSubmissionError("PRIVATE_PHOTO_UNAVAILABLE");
          await links.linkInTransaction(tx, { uploadId: stored.uploadId, subjectId, sessionId: input.sessionId, kind: input.kind });
          return { subjectId, replayed: true };
        }
        let subjectId: string;
        if (input.kind === "identity") {
          const account = await tx.user.findUniqueOrThrow({ where: { id: input.actorId }, select: { kycStatus: true } });
          if (account.kycStatus === "VERIFIED") throw new PrivatePhotoSubmissionError("PRIVATE_PHOTO_ALREADY_VERIFIED");
          await tx.identityVerification.updateMany({ where: { userId: input.actorId, status: "PENDING" }, data: { status: "REJECTED", reviewedAt: new Date(), reviewNote: "Superseded by a newer customer submission." } });
          const record = await tx.identityVerification.create({ data: {
            userId: input.actorId, ...input.details, status: "PENDING",
            documentPhotoMimeType: reference.mimeType, documentPhotoSizeBytes: reference.sizeBytes, documentPhotoSha256: reference.plaintextSha256,
          } });
          subjectId = record.id;
          await tx.user.update({ where: { id: input.actorId }, data: { kycStatus: "PENDING" } });
        } else {
          const record = await tx.inspectionEvidence.create({ data: {
            uploadedById: input.actorId, packageId: input.packageId, mediaKind: "PHOTO",
            mimeType: reference.mimeType, sizeBytes: reference.sizeBytes, sha256: reference.plaintextSha256,
          } });
          subjectId = record.id;
        }
        await links.linkInTransaction(tx, { uploadId: stored.uploadId, subjectId, sessionId: input.sessionId, kind: input.kind });
        const metadata: Prisma.InputJsonObject = input.kind === "identity"
          ? { ...input.details, photoReceived: true, photoMimeType: reference.mimeType, photoBytes: reference.sizeBytes }
          : { evidenceId: subjectId, mediaKind: "PHOTO", mimeType: reference.mimeType, sizeBytes: reference.sizeBytes };
        await tx.auditLog.create({ data: {
          actorId: input.actorId,
          action: input.kind === "identity" ? "identity_verification.submitted" : "inspection.evidence_uploaded",
          entityType: input.kind === "identity" ? "IdentityVerification" : "Package",
          entityId: input.kind === "identity" ? subjectId : input.packageId,
          metadata,
        } });
        return { subjectId, replayed: false };
      });
      if (!result) throw new PrivatePhotoSubmissionError("PRIVATE_PHOTO_ACCESS_CHANGED");
      return result;
    },
  };
}
