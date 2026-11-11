import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";

export const photoQuarantineReasons = {
  SUSPECTED_MALWARE: "Suspected malware",
  PRIVACY_REVIEW: "Privacy review",
  INTEGRITY_FAILURE: "File integrity failure",
} as const;
export const photoQueueQuery = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1), state: z.enum(["all", "quarantined"]).default("all") }).strict();
export const photoQuarantineRequest = z.object({ reason: z.enum(["SUSPECTED_MALWARE", "PRIVACY_REVIEW", "INTEGRITY_FAILURE"]), confirmed: z.literal(true), idempotencyKey: z.uuid() }).strict();
export const photoReviewDecisions = {
  KEEP_BLOCKED: "Keep blocked",
  RESCAN_REQUIRED: "Rescan required (not performed)",
  REPLACEMENT_REQUIRED: "Replacement photo required",
} as const;
export const photoReviewRequest = z.object({
  decision: z.enum(["KEEP_BLOCKED", "RESCAN_REQUIRED", "REPLACEMENT_REQUIRED"]),
  caseReference: z.string().min(8).max(80).regex(/^(INC|SEC|KYC|OPS)-[A-Z0-9]+(?:-[A-Z0-9]+){0,5}$/),
  expectedSequence: z.number().int().nonnegative().max(1_000_000),
  blockedConfirmed: z.literal(true), idempotencyKey: z.uuid(),
}).strict();
export const photoReviewPage = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1) }).strict();
const reviewSelect = { id: true, sequence: true, decision: true, caseReference: true, createdAt: true, actor: { select: { fullName: true } } } as const;
export class PhotoQuarantineError extends Error {
  constructor(code: "PHOTO_QUARANTINE_DENIED" | "PHOTO_QUARANTINE_CONFLICT" | "PHOTO_QUARANTINE_UNAVAILABLE") { super(code); }
}
export async function authorizePrivatePhotoAdmin(tx: Prisma.TransactionClient, sessionId: string) {
  const first = await tx.authSession.findUnique({ where: { id: sessionId }, select: { userId: true } });
  if (!first) throw new PhotoQuarantineError("PHOTO_QUARANTINE_DENIED");
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${first.userId} FOR NO KEY UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "AuthSession" WHERE "id" = ${sessionId} FOR SHARE`;
  const session = await tx.authSession.findUnique({ where: { id: sessionId }, include: { user: { include: { roles: { include: { role: true } } } } } });
  if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.status !== "ACTIVE" || session.user.deletedAt || session.portal !== "admin" || !session.mfaVerifiedAt || !session.user.roles.some(item => item.role.code === "admin")) throw new PhotoQuarantineError("PHOTO_QUARANTINE_DENIED");
  return session.userId;
}
export function createPhotoQuarantine(db: PrismaClient) {
  async function run<T>(sessionId: string, action: (tx: Prisma.TransactionClient, actorId: string) => Promise<T>) {
    try {
      z.uuid().parse(sessionId);
      return await db.$transaction(async tx => action(tx, await authorizePrivatePhotoAdmin(tx, sessionId)));
    } catch (error) {
      try {
        const session = z.uuid().safeParse(sessionId).success ? await db.authSession.findUnique({ where: { id: sessionId }, select: { userId: true } }) : null;
        await db.auditLog.create({ data: { actorId: session?.userId, action: "private_photo.control_blocked", entityType: "PrivatePhotoQuarantine", metadata: { outcome: error instanceof PhotoQuarantineError ? error.message : "unavailable" } } });
      } catch { throw new PhotoQuarantineError("PHOTO_QUARANTINE_UNAVAILABLE"); }
      if (error instanceof PhotoQuarantineError) throw error;
      throw new PhotoQuarantineError("PHOTO_QUARANTINE_UNAVAILABLE");
    }
  }
  return {
    list: (sessionId: string, raw: z.input<typeof photoQueueQuery>) => run(sessionId, async (tx, actorId) => {
      const { page, state } = photoQueueQuery.parse(raw);
      const rows = await tx.privatePhotoUpload.findMany({ where: state === "quarantined" ? { quarantine: { isNot: null } } : {}, select: { id: true, purpose: true, status: true, createdAt: true, privatePhotoLink: { select: { id: true } }, quarantine: { select: { id: true, reason: true, createdAt: true, reviews: { select: { sequence: true, decision: true }, orderBy: { sequence: "desc" }, take: 1 } } } }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (page - 1) * 50, take: 51 });
      await tx.auditLog.create({ data: { actorId, action: "private_photo.queue_viewed", entityType: "PrivatePhotoQuarantine", metadata: { page, state } } });
      return { items: rows.slice(0, 50).map(({ privatePhotoLink, ...row }) => ({ ...row, linked: Boolean(privatePhotoLink) })), page, hasMore: rows.length > 50 };
    }),
    history: (sessionId: string, uploadId: string, raw: z.input<typeof photoReviewPage>) => run(sessionId, async (tx, actorId) => {
      z.uuid().parse(uploadId); const { page } = photoReviewPage.parse(raw);
      const item = await tx.privatePhotoQuarantine.findUnique({ where: { uploadId }, select: { id: true } });
      if (!item) throw new PhotoQuarantineError("PHOTO_QUARANTINE_DENIED");
      const rows = await tx.privatePhotoQuarantineReview.findMany({ where: { quarantineId: item.id }, select: reviewSelect, orderBy: { sequence: "desc" }, skip: (page - 1) * 50, take: 51 });
      const latest = await tx.privatePhotoQuarantineReview.findFirst({ where: { quarantineId: item.id }, orderBy: { sequence: "desc" }, select: { sequence: true, decision: true } });
      const rescans = await tx.privatePhotoRescan.findMany({ where: { uploadId }, select: { id: true, createdAt: true, deadlineAt: true, review: { select: { sequence: true } }, result: { select: { state: true, completedAt: true } } }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 10 });
      await tx.auditLog.create({ data: { actorId, action: "private_photo.review_history_viewed", entityType: "PrivatePhotoQuarantine", entityId: item.id, metadata: { page } } });
      return { items: rows.slice(0, 50), page, hasMore: rows.length > 50, quarantined: true, latestSequence: latest?.sequence ?? 0, latestDecision: latest?.decision ?? null, rescans: rescans.map(row => ({ id: row.id, state: row.result?.state ?? (row.deadlineAt <= new Date() ? "EXPIRED" : "PENDING"), createdAt: row.createdAt, completedAt: row.result?.completedAt ?? null, reviewSequence: row.review.sequence })) };
    }),
    review: (sessionId: string, uploadId: string, raw: z.input<typeof photoReviewRequest>) => run(sessionId, async (tx, actorId) => {
      z.uuid().parse(uploadId); const input = photoReviewRequest.parse(raw);
      await tx.$queryRaw`SELECT "id" FROM "PrivatePhotoUpload" WHERE "id" = ${uploadId} FOR UPDATE`;
      const item = await tx.privatePhotoQuarantine.findUnique({ where: { uploadId }, select: { id: true } });
      if (!item) throw new PhotoQuarantineError("PHOTO_QUARANTINE_DENIED");
      const existing = await tx.privatePhotoQuarantineReview.findUnique({ where: { actorId_idempotencyKey: { actorId, idempotencyKey: input.idempotencyKey } }, select: { ...reviewSelect, quarantineId: true } });
      if (existing) {
        if (existing.quarantineId !== item.id || existing.sequence !== input.expectedSequence + 1 || existing.decision !== input.decision || existing.caseReference !== input.caseReference) throw new PhotoQuarantineError("PHOTO_QUARANTINE_CONFLICT");
        const { quarantineId: _privateId, ...review } = existing; void _privateId;
        return { review, quarantined: true, replayed: true };
      }
      const latest = await tx.privatePhotoQuarantineReview.findFirst({ where: { quarantineId: item.id }, orderBy: { sequence: "desc" }, select: { sequence: true } });
      if ((latest?.sequence ?? 0) !== input.expectedSequence) throw new PhotoQuarantineError("PHOTO_QUARANTINE_CONFLICT");
      const review = await tx.privatePhotoQuarantineReview.create({ data: { quarantineId: item.id, actorId, idempotencyKey: input.idempotencyKey, sequence: input.expectedSequence + 1, decision: input.decision, caseReference: input.caseReference }, select: reviewSelect });
      await tx.auditLog.create({ data: { actorId, action: "private_photo.quarantine_reviewed", entityType: "PrivatePhotoQuarantineReview", entityId: review.id, metadata: { decision: input.decision, sequence: review.sequence } } });
      return { review, quarantined: true, replayed: false };
    }),
    block: (sessionId: string, uploadId: string, raw: z.input<typeof photoQuarantineRequest>) => run(sessionId, async (tx, actorId) => {
      z.uuid().parse(uploadId);
      const input = photoQuarantineRequest.parse(raw);
      await tx.$queryRaw`SELECT "id" FROM "PrivatePhotoUpload" WHERE "id" = ${uploadId} FOR UPDATE`;
      const upload = await tx.privatePhotoUpload.findUnique({ where: { id: uploadId }, select: { id: true } });
      if (!upload) throw new PhotoQuarantineError("PHOTO_QUARANTINE_DENIED");
      const existing = await tx.privatePhotoQuarantine.findFirst({ where: { OR: [{ uploadId }, { actorId, idempotencyKey: input.idempotencyKey }] } });
      if (existing) {
        if (existing.uploadId !== uploadId || existing.actorId !== actorId || existing.idempotencyKey !== input.idempotencyKey || existing.reason !== input.reason) throw new PhotoQuarantineError("PHOTO_QUARANTINE_CONFLICT");
        return { quarantined: true, replayed: true };
      }
      const item = await tx.privatePhotoQuarantine.create({ data: { uploadId, actorId, reason: input.reason, idempotencyKey: input.idempotencyKey } });
      await tx.auditLog.create({ data: { actorId, action: "private_photo.quarantined", entityType: "PrivatePhotoQuarantine", entityId: item.id, metadata: { uploadId, reason: input.reason } } });
      return { quarantined: true, replayed: false };
    }),
  };
}

/** Also guards existing DB-backed routes for a linked quarantined photo. */
export async function isPrivateRecordQuarantined(db: PrismaClient, kind: "identity" | "inspection", subjectId: string) {
  return Boolean(await db.privatePhotoLink.findFirst({ where: { ...(kind === "identity" ? { identityVerificationId: subjectId } : { inspectionEvidenceId: subjectId }), upload: { quarantine: { isNot: null } } }, select: { id: true } }));
}


export async function blockQuarantinedPrivateRecord(db: PrismaClient, kind: "identity" | "inspection", subjectId: string, actorId: string) {
  if (!await isPrivateRecordQuarantined(db, kind, subjectId)) return false;
  await db.auditLog.create({ data: { actorId, action: "private_photo.legacy_view_blocked", entityType: "PrivatePhotoDelivery", metadata: { kind, outcome: "quarantined" } } });
  return true;
}
