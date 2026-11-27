import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { lockActiveAccount } from "@/modules/auth/account-mutation";
import { videoRetentionReview, videoSafetyJobSelect } from "./video-retention";

export const videoSafetyQuery = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1), state: z.enum(["all", "quarantined"]).default("all") }).strict();
export const videoQuarantineRequest = z.object({ reason: z.enum(["SUSPECTED_MALWARE", "PRIVACY_REVIEW", "INTEGRITY_FAILURE"]), caseReference: z.string().min(8).max(80).regex(/^(INC|SEC|KYC|OPS)-[A-Z0-9]+(?:-[A-Z0-9]+){0,5}$/), confirmed: z.literal(true), idempotencyKey: z.uuid() }).strict();
export class VideoSafetyError extends Error {
  constructor(code: "VIDEO_SAFETY_DENIED" | "VIDEO_SAFETY_CONFLICT" | "VIDEO_SAFETY_UNAVAILABLE") { super(code); }
}
async function now(tx: Prisma.TransactionClient) {
  const [row] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp()::timestamp(3) AS "now"`;
  if (!(row?.now instanceof Date) || !Number.isFinite(row.now.getTime())) throw new VideoSafetyError("VIDEO_SAFETY_UNAVAILABLE");
  return row.now;
}
async function authorize(tx: Prisma.TransactionClient, sessionId: string) {
  const first = await tx.authSession.findUnique({ where: { id: sessionId }, select: { userId: true } });
  if (!first || !await lockActiveAccount(tx, first.userId, sessionId)) throw new VideoSafetyError("VIDEO_SAFETY_DENIED");
  await tx.$queryRaw`SELECT "roleId" FROM "UserRole" WHERE "userId" = ${first.userId} FOR SHARE`;
  const roles = await tx.userRole.findMany({ where: { userId: first.userId }, select: { role: { select: { code: true } } } });
  const session = await tx.authSession.findUniqueOrThrow({ where: { id: sessionId } }), clock = await now(tx);
  if (session.portal !== "admin" || session.revokedAt || session.expiresAt <= clock || !session.mfaVerifiedAt || session.mfaVerifiedAt > clock || clock.getTime() - session.mfaVerifiedAt.getTime() > 15 * 60000 || !roles.some(row => row.role.code === "admin")) throw new VideoSafetyError("VIDEO_SAFETY_DENIED");
  return first.userId;
}

/** Admin metadata/quarantine only. No object reads, release or deletion executor. */
export function createVideoSafety(db: PrismaClient) {
  async function run<T>(sessionId: string, callback: (tx: Prisma.TransactionClient, actorId: string) => Promise<T>) {
    try {
      z.uuid().parse(sessionId);
      return await db.$transaction(async tx => {
        // Same policy/hold mutex and lock order as the existing media lifecycle.
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(191119, 1)`;
        const actorId = await authorize(tx, sessionId);
        const result = await callback(tx, actorId);
        if (await authorize(tx, sessionId) !== actorId) throw new VideoSafetyError("VIDEO_SAFETY_DENIED");
        return result;
      });
    } catch (error) {
      try {
        const session = z.uuid().safeParse(sessionId).success ? await db.authSession.findUnique({ where: { id: sessionId }, select: { userId: true } }) : null;
        await db.auditLog.create({ data: { actorId: session?.userId, action: "private_video.control_blocked", entityType: "PrivateVideoQuarantine", metadata: { outcome: error instanceof VideoSafetyError ? error.message : "unavailable" } } });
      } catch { throw new VideoSafetyError("VIDEO_SAFETY_UNAVAILABLE"); }
      if (error instanceof VideoSafetyError) throw error;
      throw new VideoSafetyError("VIDEO_SAFETY_UNAVAILABLE");
    }
  }
  return {
    list: (sessionId: string, raw: z.input<typeof videoSafetyQuery>) => run(sessionId, async (tx, actorId) => {
      const query = videoSafetyQuery.parse(raw), clock = await now(tx);
      const policy = await tx.privateMediaPolicy.findFirst({ orderBy: { sequence: "desc" }, select: { sequence: true, inspectionDays: true, abandonedHours: true } });
      const rows = await tx.privateVideoJob.findMany({ where: query.state === "quarantined" ? { quarantine: { isNot: null } } : {}, select: videoSafetyJobSelect, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (query.page - 1) * 10, take: 11 });
      const items = [];
      for (const row of rows.slice(0, 10)) items.push({ id: row.id, status: row.status, createdAt: row.createdAt, packageCode: row.package.packageCode, linked: Boolean(row.evidenceLink), quarantine: row.quarantine, retention: await videoRetentionReview(tx, row, policy, clock) });
      await tx.auditLog.create({ data: { actorId, action: "private_video.safety_queue_viewed", entityType: "PrivateVideoJob", metadata: query } });
      return { ...query, policy, evaluatedAt: clock, deletionEnabled: false as const, hasMore: rows.length > 10, items };
    }),
    block: (sessionId: string, jobId: string, raw: z.input<typeof videoQuarantineRequest>) => run(sessionId, async (tx, actorId) => {
      z.uuid().parse(jobId); const input = videoQuarantineRequest.parse(raw);
      await tx.$queryRaw`SELECT "id" FROM "PrivateVideoJob" WHERE "id" = ${jobId} FOR UPDATE`;
      if (!await tx.privateVideoJob.findUnique({ where: { id: jobId }, select: { id: true } })) throw new VideoSafetyError("VIDEO_SAFETY_DENIED");
      const reused = await tx.privateVideoQuarantine.findUnique({ where: { actorId_idempotencyKey: { actorId, idempotencyKey: input.idempotencyKey } } });
      const existing = await tx.privateVideoQuarantine.findUnique({ where: { jobId } });
      const row = reused ?? existing;
      if (row) {
        if (row.jobId !== jobId || row.actorId !== actorId || row.idempotencyKey !== input.idempotencyKey || row.reason !== input.reason || row.caseReference !== input.caseReference) throw new VideoSafetyError("VIDEO_SAFETY_CONFLICT");
        return { jobId, quarantined: true as const, replayed: true };
      }
      await tx.privateVideoQuarantine.create({ data: { jobId, actorId, reason: input.reason, caseReference: input.caseReference, idempotencyKey: input.idempotencyKey, createdAt: await now(tx) } });
      await tx.auditLog.create({ data: { actorId, action: "private_video.quarantined", entityType: "PrivateVideoJob", entityId: jobId, metadata: { reason: input.reason, caseReference: input.caseReference } } });
      return { jobId, quarantined: true as const, replayed: false };
    }),
  };
}
