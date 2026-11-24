import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { buildDeletionSnapshot, lockPrivateMediaLifecycle } from "./lifecycle";
import { parsePrivatePhotoReference, type createPrivatePhotoStore } from "./photos";

type Tx = Prisma.TransactionClient;
type Store = Pick<ReturnType<typeof createPrivatePhotoStore>, "namespace" | "remove" | "confirmRemoval">;
type State = "PENDING" | "BLOCKED" | "UNCERTAIN" | "VERSION_ABSENT";
export const abandonedCleanupRequest = z.object({ reviewRequestId: z.uuid(), idempotencyKey: z.uuid(), confirmed: z.literal(true) }).strict();
export const abandonedCleanupReconciliation = z.object({ idempotencyKey: z.uuid(), confirmed: z.literal(true) }).strict();
export class AbandonedCleanupError extends Error {
  constructor(code: "CLEANUP_DISABLED" | "CLEANUP_DENIED" | "CLEANUP_CONFLICT" | "CLEANUP_OUT_OF_SCOPE" | "CLEANUP_UNAVAILABLE") { super(code); }
}
const error = (code: ConstructorParameters<typeof AbandonedCleanupError>[0]) => new AbandonedCleanupError(code);
const allowedOwnerRelations = new Set(["roles", "authSessions", "addresses", "privatePhotoUploads", "auditLogs", "notifications", "notificationPreferences", "securityTokens", "userEvents", "carts", "wishlistItems"]);

/** Internal, default-disabled worker. No production runtime, route or scheduler constructs it.
 * Only unbound identity uploads belonging to a context-free personal customer qualify.
 * Linked media, transactional accounts, replicas/backups and legacy data are unsupported.
 */
export function createAbandonedPhotoCleanup(db: PrismaClient, store: Store, options: { enabled?: boolean } = {}) {
  const enabled = options.enabled === true;
  async function transaction<T>(action: (tx: Tx) => Promise<T>) {
    return db.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`;
      await lockPrivateMediaLifecycle(tx);
      return action(tx);
    }, { timeout: 120_000, maxWait: 5_000 });
  }
  async function clock(tx: Tx) {
    const [row] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp()::timestamp(3) AS now`;
    return row.now;
  }
  async function context(tx: Tx, sessionId: string, requestId: string) {
    const sessionBefore = await tx.authSession.findUnique({ where: { id: sessionId }, select: { userId: true } });
    const request = await tx.privateMediaDeletionRequest.findUnique({ where: { id: requestId }, include: { decision: true } });
    const before = request && await tx.privatePhotoUpload.findUnique({ where: { id: request.uploadId }, select: { actorId: true } });
    if (!sessionBefore || !request?.decision || request.decision.decision !== "APPROVED" || !before) throw error("CLEANUP_DENIED");
    const executor = sessionBefore.userId, requester = request.actorId, reviewer = request.decision.actorId, owner = before.actorId;
    // FOR UPDATE also fences new child rows through their immediate User FKs.
    // All existing non-whitelisted domain records make this initial scope ineligible.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" IN (${executor},${requester},${reviewer},${owner}) ORDER BY "id" FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "AuthSession" WHERE "id" = ${sessionId} FOR SHARE`;
    const roles = await tx.$queryRaw<Array<{ userId: string; code: string }>>`SELECT ur."userId",r."code" FROM "UserRole" ur JOIN "Role" r ON r."id"=ur."roleId" WHERE ur."userId" IN (${executor},${requester},${reviewer},${owner}) ORDER BY ur."userId",ur."roleId" FOR SHARE OF ur,r`;
    await tx.$queryRaw`SELECT "id" FROM "PrivatePhotoUpload" WHERE "id"=${request.uploadId} FOR UPDATE`;
    const session = await tx.authSession.findUnique({ where: { id: sessionId } });
    const people = await tx.user.findMany({ where: { id: { in: [executor, requester, reviewer] } }, select: { id: true, status: true, deletedAt: true } });
    const now = await clock(tx);
    const has = (id: string, code: string) => roles.some(row => row.userId === id && row.code === code);
    if (!session || session.userId !== executor || session.revokedAt || session.portal !== "admin" || !session.mfaVerifiedAt || session.mfaVerifiedAt > now || session.expiresAt <= now || executor === requester || reviewer === requester || ![executor,requester,reviewer].every(id => people.some(person => person.id === id && person.status === "ACTIVE" && !person.deletedAt)) || !has(executor,"admin") || !has(executor,"compliance") || !has(requester,"admin") || !has(reviewer,"admin") || !has(reviewer,"compliance")) throw error("CLEANUP_DENIED");
    const upload = await tx.privatePhotoUpload.findUniqueOrThrow({ where: { id: request.uploadId }, include: { privatePhotoLink: true, quarantine: true } });
    if (upload.actorId !== owner) throw error("CLEANUP_CONFLICT");
    return { request, upload, owner, executor, session, ownerRoles: roles.filter(row => row.userId === owner).map(row => row.code) };
  }
  async function preflight(tx: Tx, ctx: Awaited<ReturnType<typeof context>>, ignoredAttemptId?: string) {
    const { request, upload } = ctx;
    const owner = await tx.user.findUniqueOrThrow({ where: { id: ctx.owner }, select: { status: true, accountType: true, kycStatus: true, deletedAt: true, createdAt: true, sellerProfile: { select: { id: true } }, businessAccount: { select: { id: true } }, supportAgentProfile: { select: { userId: true } }, _count: true } });
    const [unbound] = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "PrivatePhotoUpload" WHERE "id"=${upload.id} AND "submissionScope" IS NULL`;
    if (!unbound || upload.purpose !== "identity" || upload.status !== "STORED" || upload.privatePhotoLink || upload.quarantine || upload.encryptedBody || upload.leaseToken || upload.leaseExpiresAt || upload.createdAt < owner.createdAt || owner.status !== "ACTIVE" || owner.deletedAt || owner.accountType !== "PERSONAL" || owner.kycStatus !== "NOT_REQUIRED" || owner.sellerProfile || owner.businessAccount || owner.supportAgentProfile || ctx.ownerRoles.length !== 1 || ctx.ownerRoles[0] !== "customer_personal" || Object.entries(owner._count).some(([relation,count]) => !allowedOwnerRelations.has(relation) && count > 0)) throw error("CLEANUP_OUT_OF_SCOPE");
    if (upload.storageNamespace !== store.namespace) throw error("CLEANUP_CONFLICT");
    const snapshot = await buildDeletionSnapshot(tx, upload.id, ignoredAttemptId);
    if (snapshot.policySequence !== request.policySequence || snapshot.snapshotDigest !== request.snapshotDigest || snapshot.reviewAfter.getTime() !== request.reviewAfter.getTime()) throw error("CLEANUP_CONFLICT");
    const now = await clock(tx);
    // The trusted store has four independently bounded 12-second operations.
    if (Math.min(request.expiresAt.getTime(),ctx.session.expiresAt.getTime()) - now.getTime() <= 60_000) throw error("CLEANUP_CONFLICT");
    return { reference: parsePrivatePhotoReference(upload.storedReference), now };
  }
  async function latest(tx: Tx, attemptId: string, replayed: boolean) {
    const row = await tx.privateMediaCleanupObservation.findFirst({ where: { attemptId }, orderBy: { sequence: "desc" }, select: { state: true } });
    return { attemptId, state: (row?.state ?? "PENDING") as State, replayed, scope: "ABANDONED_IDENTITY_ONLY" as const };
  }
  async function observe(tx: Tx, input: { attemptId: string; actorId: string; key: string; kind: "EXECUTE" | "RECONCILE"; state: Exclude<State,"PENDING">; uploadId: string }) {
    const prior = await tx.privateMediaCleanupObservation.findFirst({ where: { attemptId: input.attemptId }, orderBy: { sequence: "desc" } });
    if (prior?.state === "VERSION_ABSENT" || (prior?.sequence ?? 0) >= 10) throw error("CLEANUP_CONFLICT");
    await tx.privateMediaCleanupObservation.create({ data: { attemptId: input.attemptId, actorId: input.actorId, idempotencyKey: input.key, kind: input.kind, state: input.state, sequence: (prior?.sequence ?? 0) + 1 } });
    if (input.state === "VERSION_ABSENT") {
      await tx.$executeRaw`UPDATE "PrivatePhotoUpload" SET "status"='REMOVED',"storedReference"=NULL,"preparedReference"='{}'::jsonb,"submissionScope"=NULL,"encryptedBody"=NULL,"originalScanSha256"=NULL,"originalScanVerifiedAt"=NULL,"scanVerifiedSha256"=NULL,"scanVerifiedAt"=NULL,"leaseToken"=NULL,"leaseExpiresAt"=NULL,"updatedAt"=clock_timestamp() WHERE "id"=${input.uploadId}`;
    }
    await tx.auditLog.create({ data: { actorId: input.actorId, action: "private_media.cleanup_observed", entityType: "PrivateMediaCleanupAttempt", entityId: input.attemptId, metadata: { state: input.state, kind: input.kind, scope: "ABANDONED_IDENTITY_ONLY" } } });
    return latest(tx,input.attemptId,false);
  }
  async function process(sessionId: string, attemptId: string, key: string, kind: "EXECUTE" | "RECONCILE") {
    return transaction(async tx => {
      const started = performance.now();
      const attempt = await tx.privateMediaCleanupAttempt.findUnique({ where: { id: attemptId } });
      if (!attempt) throw error("CLEANUP_DENIED");
      const ctx = await context(tx,sessionId,attempt.requestId);
      const history = await tx.privateMediaCleanupObservation.findFirst({ where: { attemptId }, orderBy: { sequence: "desc" } });
      const replay = await tx.privateMediaCleanupObservation.findUnique({ where: { actorId_idempotencyKey: { actorId: ctx.executor, idempotencyKey: key } } });
      if (replay) { if (replay.attemptId !== attemptId || replay.kind !== kind) throw error("CLEANUP_CONFLICT"); return { attemptId, state: replay.state as State, replayed: true, scope: "ABANDONED_IDENTITY_ONLY" as const }; }
      if (history?.state === "VERSION_ABSENT" || kind === "EXECUTE" && history) return latest(tx,attemptId,true);
      if (kind === "EXECUTE" && attempt.actorId !== ctx.executor) throw error("CLEANUP_DENIED");
      const record = (state: Exclude<State,"PENDING">) => observe(tx,{ attemptId, actorId: ctx.executor, key, kind, state, uploadId: attempt.uploadId });
      let checked;
      try {
        checked = await preflight(tx,ctx,attemptId);
        const reference = parsePrivatePhotoReference(attempt.referenceSnapshot);
        if (attempt.uploadId !== ctx.upload.id || attempt.storageNamespace !== store.namespace || reference.key !== checked.reference.key || reference.versionId !== checked.reference.versionId || performance.now()-started > 30_000 || kind === "EXECUTE" && attempt.deadlineAt.getTime()-checked.now.getTime() <= 60_000) return record("BLOCKED");
      } catch { return record("BLOCKED"); }
      let state: "UNCERTAIN" | "VERSION_ABSENT" = "UNCERTAIN";
      try {
        // Never race a timeout against this promise: the DB fences must outlive S3 I/O.
        const receipt = kind === "EXECUTE" ? await store.remove(checked.reference) : await store.confirmRemoval(checked.reference);
        if (receipt.versionId === checked.reference.versionId && receipt.versionAbsent === true) state = "VERSION_ABSENT";
      } catch { /* Unknown outcome: preserve the durable attempt and never resend DELETE. */ }
      return record(state);
    });
  }
  async function guarded<T>(sessionId: string, action: () => Promise<T>) {
    if (!enabled) throw error("CLEANUP_DISABLED");
    if (!/^[a-f0-9]{64}$/.test(store.namespace)) throw error("CLEANUP_UNAVAILABLE");
    try { return await action(); }
    catch (cause) {
      const outcome = cause instanceof AbandonedCleanupError ? cause : error("CLEANUP_UNAVAILABLE");
      try {
        const session = z.uuid().safeParse(sessionId).success ? await db.authSession.findUnique({ where: { id: sessionId }, select: { userId: true } }) : null;
        await db.auditLog.create({ data: { actorId: session?.userId, action: "private_media.cleanup_blocked", entityType: "PrivateMediaCleanupAttempt", metadata: { outcome: outcome.message, scope: "ABANDONED_IDENTITY_ONLY" } } });
      } catch { throw error("CLEANUP_UNAVAILABLE"); }
      throw outcome;
    }
  }
  return {
    execute: (sessionId: string, raw: z.input<typeof abandonedCleanupRequest>) => guarded(sessionId,async () => {
      z.uuid().parse(sessionId); const input = abandonedCleanupRequest.parse(raw);
      // This commit precedes ALL storage I/O and survives a crash or audit failure later.
      const reserved = await transaction(async tx => {
        const ctx = await context(tx,sessionId,input.reviewRequestId);
        const replay = await tx.privateMediaCleanupAttempt.findUnique({ where: { actorId_idempotencyKey: { actorId: ctx.executor, idempotencyKey: input.idempotencyKey } } });
        if (replay) { if (replay.requestId !== input.reviewRequestId) throw error("CLEANUP_CONFLICT"); return { created: false, result: await latest(tx,replay.id,true) }; }
        if (await tx.privateMediaCleanupAttempt.findUnique({ where: { uploadId: ctx.upload.id }, select: { id: true } })) throw error("CLEANUP_CONFLICT");
        const checked = await preflight(tx,ctx);
        const attempt = await tx.privateMediaCleanupAttempt.create({ data: { requestId: ctx.request.id, uploadId: ctx.upload.id, actorId: ctx.executor, idempotencyKey: input.idempotencyKey, storageNamespace: store.namespace, referenceSnapshot: checked.reference, deadlineAt: new Date(checked.now.getTime()+120_000) } });
        await tx.auditLog.create({ data: { actorId: ctx.executor, action: "private_media.cleanup_reserved", entityType: "PrivateMediaCleanupAttempt", entityId: attempt.id, metadata: { scope: "ABANDONED_IDENTITY_ONLY" } } });
        return { created: true, result: await latest(tx,attempt.id,false) };
      });
      return reserved.created ? process(sessionId,reserved.result.attemptId,input.idempotencyKey,"EXECUTE") : reserved.result;
    }),
    reconcile: (sessionId: string, attemptId: string, raw: z.input<typeof abandonedCleanupReconciliation>) => guarded(sessionId,async () => {
      z.uuid().parse(sessionId); z.uuid().parse(attemptId); const input = abandonedCleanupReconciliation.parse(raw);
      return process(sessionId,attemptId,input.idempotencyKey,"RECONCILE");
    }),
  };
}
