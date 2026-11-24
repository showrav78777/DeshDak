import "server-only";
import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { authorizePrivatePhotoAdmin } from "./quarantine";
import { buildMediaReviewPreview, type mediaPreviewQuery } from "./eligibility";
import { parsePrivatePhotoReference } from "./photos";

const caseReference = z.string().min(8).max(80).regex(/^(INC|SEC|KYC|OPS)-[A-Z0-9]+(?:-[A-Z0-9]+){0,5}$/);
export const mediaPolicyRequest = z.object({ expectedSequence: z.number().int().min(0).max(1_000_000), identityDays: z.number().int().min(1).max(36500), inspectionDays: z.number().int().min(1).max(36500), abandonedHours: z.number().int().min(24).max(8760), caseReference, confirmed: z.literal(true), idempotencyKey: z.uuid() }).strict();
export const mediaHoldRequest = z.object({ scope: z.enum(["UPLOAD", "ACCOUNT", "ORDER", "PACKAGE"]), targetId: z.uuid(), caseReference, confirmed: z.literal(true), idempotencyKey: z.uuid() }).strict();
export const mediaReleaseRequest = z.object({ caseReference, confirmed: z.literal(true), idempotencyKey: z.uuid() }).strict();
export const mediaDeletionRequest = z.object({ uploadId: z.uuid(), expectedPolicySequence: z.number().int().min(1), caseReference, confirmed: z.literal(true), idempotencyKey: z.uuid() }).strict();
export const mediaDeletionDecision = z.object({ decision: z.enum(["APPROVED", "REJECTED"]), caseReference, confirmed: z.literal(true), idempotencyKey: z.uuid() }).strict();
export const mediaDeletionQuery = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1), state: z.enum(["pending", "all"]).default("pending") }).strict();
export const mediaLifecycleQuery = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1), policyPage: z.coerce.number().int().min(1).max(10000).default(1), state: z.enum(["active", "all"]).default("active") }).strict();
export const mediaPolicyDefaults = { identityDays: 90, inspectionDays: 180, abandonedHours: 24 };
export class MediaLifecycleError extends Error {
  constructor(code: "MEDIA_LIFECYCLE_DENIED" | "MEDIA_LIFECYCLE_CONFLICT" | "MEDIA_LIFECYCLE_UNAVAILABLE") { super(code); }
}
const denied = () => new MediaLifecycleError("MEDIA_LIFECYCLE_DENIED");
const conflict = () => new MediaLifecycleError("MEDIA_LIFECYCLE_CONFLICT");
const policySelect = { sequence: true, identityDays: true, inspectionDays: true, abandonedHours: true, caseReference: true, createdAt: true } as const;
function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
// A review snapshot is never an execution token. A future worker must independently
// revalidate live cases/holds/authority and exact versions before removing any bytes.
export async function buildDeletionSnapshot(tx: Prisma.TransactionClient, uploadId: string, ignoredAttemptId?: string) {
  await tx.$queryRaw`SELECT "id" FROM "PrivatePhotoUpload" WHERE "id" = ${uploadId} FOR SHARE`;
  const preview = await buildMediaReviewPreview(tx, { uploadId }, activePrivateMediaHolds, ignoredAttemptId);
  const row = preview.rows[0];
  if (!preview.policySequence || !row || row.state !== "READY_FOR_REVIEW" || !row.reviewAfter) throw conflict();
  const upload = await tx.privatePhotoUpload.findUniqueOrThrow({ where: { id: uploadId }, select: { actorId: true, purpose: true, status: true, updatedAt: true, storageNamespace: true, storedReference: true, originalScanSha256: true, originalScanVerifiedAt: true, scanVerifiedSha256: true, scanVerifiedAt: true, privatePhotoLink: { select: { identityVerificationId: true, inspectionEvidenceId: true } } } });
  const reference = parsePrivatePhotoReference(upload.storedReference);
  if (reference.purpose !== upload.purpose || reference.plaintextSha256 !== upload.scanVerifiedSha256) throw conflict();
  return { policySequence: preview.policySequence, reviewAfter: row.reviewAfter, snapshotDigest: createHash("sha256").update(canonical({ uploadId, upload, policySequence: preview.policySequence, reviewAfter: row.reviewAfter })).digest("hex"), evaluatedAt: preview.evaluatedAt };
}
// Every future eligibility/deletion claim must take this same lock before checking holds.
export async function lockPrivateMediaLifecycle(tx: Prisma.TransactionClient) {
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(191119, 1)`;
}

/** Resolve all applicable scopes, including future photos linked after a hold was placed. */
export async function activePrivateMediaHolds(tx: Prisma.TransactionClient, uploadId: string) {
  const upload = await tx.privatePhotoUpload.findUnique({ where: { id: uploadId }, select: { actorId: true, purpose: true, privatePhotoLink: { select: { identityVerification: { select: { userId: true } }, inspectionEvidence: { select: { package: { select: { id: true, orderId: true, order: { select: { customerId: true } } } } } } } } } });
  if (!upload) throw denied();
  const parcel = upload.privatePhotoLink?.inspectionEvidence?.package;
  const accountId = upload.privatePhotoLink?.identityVerification?.userId ?? parcel?.order.customerId ?? (upload.purpose === "identity" ? upload.actorId : null);
  return tx.privateMediaHold.findMany({ take: 100, where: { release: null, OR: [{ uploadId }, ...(accountId ? [{ accountId }] : []), ...(parcel ? [{ packageId: parcel.id }, { orderId: parcel.orderId }] : [])] }, select: { id: true } });
}

export function createMediaLifecycle(db: PrismaClient) {
  async function run<T>(sessionId: string, action: (tx: Prisma.TransactionClient, actorId: string, compliance: boolean) => Promise<T>) {
    try {
      z.uuid().parse(sessionId);
      return await db.$transaction(async tx => {
        await lockPrivateMediaLifecycle(tx);
        const actorId = await authorizePrivatePhotoAdmin(tx, sessionId);
        await tx.$queryRaw`SELECT "roleId" FROM "UserRole" WHERE "userId" = ${actorId} FOR SHARE`;
        const roles = (await tx.userRole.findMany({ where: { userId: actorId }, select: { role: { select: { code: true } } } })).map(row => row.role.code);
        if (!roles.includes("admin")) throw denied();
        return action(tx, actorId, roles.includes("compliance"));
      });
    } catch (error) {
      try {
        const session = z.uuid().safeParse(sessionId).success ? await db.authSession.findUnique({ where: { id: sessionId }, select: { userId: true } }) : null;
        await db.auditLog.create({ data: { actorId: session?.userId, action: "private_media.control_blocked", entityType: "PrivateMediaPolicy", metadata: { outcome: error instanceof MediaLifecycleError ? error.message : "unavailable" } } });
      } catch { throw new MediaLifecycleError("MEDIA_LIFECYCLE_UNAVAILABLE"); }
      if (error instanceof MediaLifecycleError) throw error;
      if (error instanceof Error && error.message === "PHOTO_QUARANTINE_DENIED") throw denied();
      throw new MediaLifecycleError("MEDIA_LIFECYCLE_UNAVAILABLE");
    }
  }
  return {
    deletionReviews: (sessionId: string, raw: z.input<typeof mediaDeletionQuery>) => run(sessionId, async (tx, actorId, compliance) => {
      const query = mediaDeletionQuery.parse(raw);
      const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp()::timestamp(3) AS now`;
      const policy = await tx.privateMediaPolicy.findFirst({ orderBy: { sequence: "desc" }, select: { sequence: true } });
      const requests = await tx.privateMediaDeletionRequest.findMany({ where: query.state === "pending" ? { decision: null } : {}, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 11, skip: (query.page - 1) * 10, select: { id: true, uploadId: true, policySequence: true, reviewAfter: true, actorId: true, caseReference: true, createdAt: true, expiresAt: true, decision: { select: { decision: true, caseReference: true, createdAt: true } }, cleanupAttempt: { select: { id: true, createdAt: true, observations: { orderBy: { sequence: "desc" }, take: 1, select: { state: true, createdAt: true } } } } } });
      await tx.auditLog.create({ data: { actorId, action: "private_media.deletion_reviews_viewed", entityType: "PrivateMediaDeletionRequest", metadata: query } });
      return { ...query, policySequence: policy?.sequence ?? null, deletionEnabled: false as const, hasMore: requests.length > 10, requests: requests.slice(0, 10).map(({ actorId: requester, cleanupAttempt, ...row }) => ({ ...row, cleanup: cleanupAttempt ? { attemptId: cleanupAttempt.id, createdAt: cleanupAttempt.createdAt, state: cleanupAttempt.observations[0]?.state ?? "PENDING", observedAt: cleanupAttempt.observations[0]?.createdAt ?? null } : null, expired: row.expiresAt <= clock.now, canDecide: compliance && requester !== actorId && !row.decision })) };
    }),
    requestDeletionReview: (sessionId: string, raw: z.input<typeof mediaDeletionRequest>) => run(sessionId, async (tx, actorId) => {
      const input = mediaDeletionRequest.parse(raw);
      const existing = await tx.privateMediaDeletionRequest.findUnique({ where: { actorId_idempotencyKey: { actorId, idempotencyKey: input.idempotencyKey } } });
      if (existing) {
        if (existing.uploadId !== input.uploadId || existing.policySequence !== input.expectedPolicySequence || existing.caseReference !== input.caseReference) throw conflict();
        return { id: existing.id, replayed: true, deletionEnabled: false as const };
      }
      if (await tx.privateMediaDeletionRequest.findFirst({ where: { uploadId: input.uploadId, decision: null }, select: { id: true } })) throw conflict();
      const snapshot = await buildDeletionSnapshot(tx, input.uploadId);
      if (snapshot.policySequence !== input.expectedPolicySequence) throw conflict();
      const request = await tx.privateMediaDeletionRequest.create({ data: { uploadId: input.uploadId, policySequence: snapshot.policySequence, snapshotDigest: snapshot.snapshotDigest, reviewAfter: snapshot.reviewAfter, actorId, caseReference: input.caseReference, idempotencyKey: input.idempotencyKey, expiresAt: new Date(snapshot.evaluatedAt.getTime() + 86_400_000) } });
      await tx.auditLog.create({ data: { actorId, action: "private_media.deletion_review_requested", entityType: "PrivateMediaDeletionRequest", entityId: request.id, metadata: { policySequence: request.policySequence, deletionEnabled: false } } });
      return { id: request.id, replayed: false, deletionEnabled: false as const };
    }),
    decideDeletionReview: (sessionId: string, requestId: string, raw: z.input<typeof mediaDeletionDecision>) => run(sessionId, async (tx, actorId, compliance) => {
      if (!compliance) throw denied();
      z.uuid().parse(requestId); const input = mediaDeletionDecision.parse(raw);
      const request = await tx.privateMediaDeletionRequest.findUnique({ where: { id: requestId }, include: { decision: true } });
      if (!request || request.actorId === actorId) throw denied();
      const prior = await tx.privateMediaDeletionDecision.findUnique({ where: { actorId_idempotencyKey: { actorId, idempotencyKey: input.idempotencyKey } } });
      if (prior) {
        if (prior.requestId !== requestId || prior.decision !== input.decision || prior.caseReference !== input.caseReference) throw conflict();
        return { id: prior.id, decision: prior.decision, replayed: true, deletionEnabled: false as const };
      }
      if (request.decision) throw conflict();
      if (input.decision === "APPROVED") {
        const snapshot = await buildDeletionSnapshot(tx, request.uploadId);
        if (request.expiresAt <= snapshot.evaluatedAt || snapshot.policySequence !== request.policySequence || snapshot.snapshotDigest !== request.snapshotDigest || snapshot.reviewAfter.getTime() !== request.reviewAfter.getTime()) throw conflict();
      }
      const decision = await tx.privateMediaDeletionDecision.create({ data: { requestId, actorId, decision: input.decision, caseReference: input.caseReference, idempotencyKey: input.idempotencyKey } });
      await tx.auditLog.create({ data: { actorId, action: "private_media.deletion_review_decided", entityType: "PrivateMediaDeletionRequest", entityId: requestId, metadata: { decision: input.decision, deletionEnabled: false } } });
      return { id: decision.id, decision: decision.decision, replayed: false, deletionEnabled: false as const };
    }),
    preview: (sessionId: string, raw: z.input<typeof mediaPreviewQuery>) => run(sessionId, async (tx, actorId) => {
      const result = await buildMediaReviewPreview(tx, raw, activePrivateMediaHolds);
      await tx.auditLog.create({ data: { actorId, action: "private_media.retention_previewed", entityType: "PrivateMediaPolicy", metadata: { page: result.page, purpose: result.purpose, policySequence: result.policySequence, rows: result.rows.length } } });
      return result;
    }),
    overview: (sessionId: string, raw: z.input<typeof mediaLifecycleQuery>) => run(sessionId, async (tx, actorId, compliance) => {
      const query = mediaLifecycleQuery.parse(raw);
      const current = await tx.privateMediaPolicy.findFirst({ orderBy: { sequence: "desc" }, select: policySelect });
      const policies = await tx.privateMediaPolicy.findMany({ orderBy: { sequence: "desc" }, select: policySelect, skip: (query.policyPage - 1) * 20, take: 21 });
      const holds = await tx.privateMediaHold.findMany({ where: query.state === "active" ? { release: null } : {}, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (query.page - 1) * 50, take: 51, select: { id: true, uploadId: true, accountId: true, orderId: true, packageId: true, actorId: true, caseReference: true, createdAt: true, release: { select: { caseReference: true, createdAt: true } } } });
      await tx.auditLog.create({ data: { actorId, action: "private_media.lifecycle_viewed", entityType: "PrivateMediaPolicy", metadata: query } });
      return { current, defaults: mediaPolicyDefaults, canEditPolicy: compliance, deletionEnabled: false as const, policies: policies.slice(0, 20), policyHasMore: policies.length > 20, holds: holds.slice(0, 50).map(({ actorId: requester, uploadId, accountId, orderId, packageId, ...row }) => ({ ...row, scope: uploadId ? "UPLOAD" : accountId ? "ACCOUNT" : orderId ? "ORDER" : "PACKAGE", targetId: uploadId ?? accountId ?? orderId ?? packageId!, canRelease: compliance && requester !== actorId && !row.release })), hasMore: holds.length > 50, ...query };
    }),
    savePolicy: (sessionId: string, raw: z.input<typeof mediaPolicyRequest>) => run(sessionId, async (tx, actorId, compliance) => {
      if (!compliance) throw denied();
      const input = mediaPolicyRequest.parse(raw);
      const existing = await tx.privateMediaPolicy.findUnique({ where: { actorId_idempotencyKey: { actorId, idempotencyKey: input.idempotencyKey } } });
      if (existing) {
        if (existing.sequence !== input.expectedSequence + 1 || existing.identityDays !== input.identityDays || existing.inspectionDays !== input.inspectionDays || existing.abandonedHours !== input.abandonedHours || existing.caseReference !== input.caseReference) throw conflict();
        return { sequence: existing.sequence, replayed: true, deletionEnabled: false };
      }
      const latest = await tx.privateMediaPolicy.findFirst({ orderBy: { sequence: "desc" }, select: { sequence: true } });
      if ((latest?.sequence ?? 0) !== input.expectedSequence) throw conflict();
      const policy = await tx.privateMediaPolicy.create({ data: { actorId, sequence: input.expectedSequence + 1, identityDays: input.identityDays, inspectionDays: input.inspectionDays, abandonedHours: input.abandonedHours, caseReference: input.caseReference, idempotencyKey: input.idempotencyKey } });
      await tx.auditLog.create({ data: { actorId, action: "private_media.policy_recorded", entityType: "PrivateMediaPolicy", entityId: policy.id, metadata: { sequence: policy.sequence } } });
      return { sequence: policy.sequence, replayed: false, deletionEnabled: false };
    }),
    placeHold: (sessionId: string, raw: z.input<typeof mediaHoldRequest>) => run(sessionId, async (tx, actorId) => {
      const input = mediaHoldRequest.parse(raw);
      const target = input.scope === "UPLOAD" ? { uploadId: input.targetId } : input.scope === "ACCOUNT" ? { accountId: input.targetId } : input.scope === "ORDER" ? { orderId: input.targetId } : { packageId: input.targetId };
      const existing = await tx.privateMediaHold.findUnique({ where: { actorId_idempotencyKey: { actorId, idempotencyKey: input.idempotencyKey } } });
      if (existing) {
        if (existing.caseReference !== input.caseReference || existing[({ UPLOAD: "uploadId", ACCOUNT: "accountId", ORDER: "orderId", PACKAGE: "packageId" } as const)[input.scope]] !== input.targetId) throw conflict();
        return { id: existing.id, replayed: true };
      }
      const exists = input.scope === "UPLOAD" ? await tx.privatePhotoUpload.findUnique({ where: { id: input.targetId }, select: { id: true } }) : input.scope === "ACCOUNT" ? await tx.user.findUnique({ where: { id: input.targetId }, select: { id: true } }) : input.scope === "ORDER" ? await tx.order.findUnique({ where: { id: input.targetId }, select: { id: true } }) : await tx.package.findUnique({ where: { id: input.targetId }, select: { id: true } });
      if (!exists) throw denied();
      const hold = await tx.privateMediaHold.create({ data: { ...target, actorId, caseReference: input.caseReference, idempotencyKey: input.idempotencyKey } });
      await tx.auditLog.create({ data: { actorId, action: "private_media.hold_placed", entityType: "PrivateMediaHold", entityId: hold.id, metadata: { scope: input.scope } } });
      return { id: hold.id, replayed: false };
    }),
    releaseHold: (sessionId: string, holdId: string, raw: z.input<typeof mediaReleaseRequest>) => run(sessionId, async (tx, actorId, compliance) => {
      if (!compliance) throw denied();
      z.uuid().parse(holdId); const input = mediaReleaseRequest.parse(raw);
      const hold = await tx.privateMediaHold.findUnique({ where: { id: holdId }, include: { release: true } });
      if (!hold || hold.actorId === actorId) throw denied();
      const existing = await tx.privateMediaHoldRelease.findUnique({ where: { actorId_idempotencyKey: { actorId, idempotencyKey: input.idempotencyKey } } });
      if (existing) { if (existing.holdId !== holdId || existing.caseReference !== input.caseReference) throw conflict(); return { released: true, replayed: true }; }
      if (hold.release) throw conflict();
      await tx.privateMediaHoldRelease.create({ data: { holdId, actorId, caseReference: input.caseReference, idempotencyKey: input.idempotencyKey } });
      await tx.auditLog.create({ data: { actorId, action: "private_media.hold_released", entityType: "PrivateMediaHold", entityId: holdId, metadata: { deletionEnabled: false } } });
      return { released: true, replayed: false };
    }),
  };
}
