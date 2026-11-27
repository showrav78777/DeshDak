import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { parsePrivateVideoArtifactReference, type createPrivateVideoArtifactStore, type PreparedPrivateVideoArtifact } from "./video-artifacts";

type Store = ReturnType<typeof createPrivateVideoArtifactStore>;
type Tx = Prisma.TransactionClient;
const roles = ["original", "video", "poster"] as const;
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const scopeSchema = z.object({ actorId: z.uuid(), packageId: z.uuid(), idempotencyKey: z.string().regex(/^[A-Za-z0-9:_-]{16,128}$/) }).strict();
const profileSchema = z.object({ profile: z.literal("inspection-video-v1"), originalSha256: z.string().regex(/^[a-f0-9]{64}$/), durationMs: z.number().int().min(200).max(60_000), width: z.number().int().min(16).max(1280), height: z.number().int().min(16).max(720), audio: z.boolean() }).strict();
type Profile = z.infer<typeof profileSchema>;
type Result = { jobId: string; state: "STORED" | "BUSY" | "REVIEW_REQUIRED" };
export class PrivateVideoJobError extends Error {
  constructor(code: "PRIVATE_VIDEO_JOB_UNAVAILABLE" | "PRIVATE_VIDEO_JOB_CONFLICT" = "PRIVATE_VIDEO_JOB_UNAVAILABLE") { super(code); }
}
async function clock(tx: Tx) {
  const [row] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp()::timestamp(3) AS "now"`;
  return row.now;
}
type Authorization = (tx: Tx, actorId: string, packageId: string) => Promise<boolean>;
async function lockScope(tx: Tx, actorId: string, packageId: string, authorize?: Authorization) {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${actorId} FOR NO KEY UPDATE`;
  if (authorize && !await authorize(tx, actorId, packageId)) throw new PrivateVideoJobError();
  await tx.$queryRaw`SELECT "id" FROM "Package" WHERE "id" = ${packageId} FOR UPDATE`;
  const actor = await tx.user.findUnique({ where: { id: actorId }, select: { status: true, deletedAt: true } });
  const parcel = await tx.package.findUnique({ where: { id: packageId }, select: { status: true, isOutboundActive: true } });
  if (actor?.status !== "ACTIVE" || actor.deletedAt || !parcel?.isOutboundActive || parcel.status === "EXPECTED") throw new PrivateVideoJobError();
}

/** Internal staging only. No public intake, scan approval, evidence binding or delivery authority. */
export function createPrivateVideoJobs(db: PrismaClient, store: Store, authorize?: Authorization) {
  async function stage(input: { actorId: string; packageId: string; idempotencyKey: string; profile: Profile; original: Buffer; video: Buffer; poster: Buffer }, recordProcessing?: (tx: Tx, jobId: string) => Promise<void>) {
    const scope = scopeSchema.parse({ actorId: input.actorId, packageId: input.packageId, idempotencyKey: input.idempotencyKey });
    const profile = profileSchema.parse(input.profile);
    if (roles.some(role => !Buffer.isBuffer(input[role]))) throw new PrivateVideoJobError();
    const bytes = { original: Buffer.from(input.original), video: Buffer.from(input.video), poster: Buffer.from(input.poster) };
    if (hash(bytes.original) !== profile.originalSha256) throw new PrivateVideoJobError();
    const fingerprint = hash(Buffer.from(JSON.stringify([scope.packageId, profile, ...roles.map(role => hash(bytes[role]))])));
    // Encryption is outside database locks. Only encrypted candidates are persisted.
    const prepared = roles.map(role => ({ role, data: store.prepare(role, bytes[role], role === "poster" ? "image/jpeg" : "video/mp4") }));
    return db.$transaction(async tx => {
      await lockScope(tx, scope.actorId, scope.packageId, authorize);
      const existing = await tx.privateVideoJob.findUnique({ where: { actorId_idempotencyKey: { actorId: scope.actorId, idempotencyKey: scope.idempotencyKey } } });
      if (existing) {
        if (await tx.privateVideoQuarantine.findUnique({ where: { jobId: existing.id }, select: { id: true } })) throw new PrivateVideoJobError();
        if (await tx.privateVideoUpload.findFirst({ where: { storedJobId: existing.id, status: { in: ["CANCELLED", "REVIEW_REQUIRED"] } }, select: { id: true } })) throw new PrivateVideoJobError();
        if (existing.packageId !== scope.packageId || existing.fingerprint !== fingerprint || existing.storageNamespace !== store.namespace) throw new PrivateVideoJobError("PRIVATE_VIDEO_JOB_CONFLICT");
        if (recordProcessing) await recordProcessing(tx, existing.id);
        if (authorize && !await authorize(tx, scope.actorId, scope.packageId)) throw new PrivateVideoJobError();
        return { jobId: existing.id };
      }
      const job = await tx.privateVideoJob.create({ data: { ...scope, createdAt: await clock(tx), fingerprint, storageNamespace: store.namespace, profile, artifacts: { create: prepared.map(({ role, data }) => ({ role, preparedReference: data.reference, encryptedBody: data.encryptedBody })) } } });
      await tx.auditLog.create({ data: { actorId: scope.actorId, action: "private_video.prepared", entityType: "PrivateVideoJob", entityId: job.id, metadata: { profile: profile.profile } } });
      if (recordProcessing) await recordProcessing(tx, job.id);
      if (authorize && !await authorize(tx, scope.actorId, scope.packageId)) throw new PrivateVideoJobError();
      return { jobId: job.id };
    });
  }
  async function locked<T>(jobId: string, callback: (tx: Tx, job: NonNullable<Awaited<ReturnType<Tx["privateVideoJob"]["findUnique"]>>>, now: Date) => Promise<T>) {
    const scope = await db.privateVideoJob.findUniqueOrThrow({ where: { id: jobId } });
    return db.$transaction(async tx => {
      await lockScope(tx, scope.actorId, scope.packageId, authorize);
      await tx.$queryRaw`SELECT "id" FROM "PrivateVideoJob" WHERE "id" = ${jobId} FOR UPDATE`;
      const job = await tx.privateVideoJob.findUniqueOrThrow({ where: { id: jobId } });
      if (await tx.privateVideoQuarantine.findUnique({ where: { jobId }, select: { id: true } })) throw new PrivateVideoJobError();
      if (await tx.privateVideoUpload.findFirst({ where: { storedJobId: jobId, status: { in: ["CANCELLED", "REVIEW_REQUIRED"] } }, select: { id: true } })) throw new PrivateVideoJobError();
      if (job.actorId !== scope.actorId || job.packageId !== scope.packageId || job.storageNamespace !== store.namespace) throw new PrivateVideoJobError();
      const result = await callback(tx, job, await clock(tx));
      if (authorize && !await authorize(tx, scope.actorId, scope.packageId)) throw new PrivateVideoJobError();
      return result;
    });
  }
  async function run(jobId: string): Promise<Result> {
    if (!z.uuid().safeParse(jobId).success) throw new PrivateVideoJobError();
    const token = randomUUID();
    const claimed = await locked(jobId, async (tx, job, now) => {
      if (job.status === "STORED") return "STORED" as const;
      if (job.leaseExpiresAt && job.leaseExpiresAt > now) return "BUSY" as const;
      if (job.attempts >= 5) return "REVIEW_REQUIRED" as const;
      await tx.privateVideoJob.update({ where: { id: jobId }, data: { status: "PROCESSING", attempts: { increment: 1 }, leaseToken: token, leaseExpiresAt: new Date(now.getTime() + 300_000) } });
      await tx.auditLog.create({ data: { actorId: job.actorId, action: "private_video.claimed", entityType: "PrivateVideoJob", entityId: jobId } });
      return "CLAIMED" as const;
    });
    if (claimed !== "CLAIMED") return { jobId, state: claimed };
    const owns = (job: { leaseToken: string | null; leaseExpiresAt: Date | null; status: string }, now: Date) => job.status === "PROCESSING" && job.leaseToken === token && job.leaseExpiresAt && job.leaseExpiresAt > now;
    try {
      for (const role of roles) {
        const pending = await locked(jobId, async (tx, job, now) => {
          if (!owns(job, now)) throw new PrivateVideoJobError();
          const artifact = await tx.privateVideoArtifact.findUniqueOrThrow({ where: { jobId_role: { jobId, role } } });
          if (artifact.status === "STORED") return null;
          if (!artifact.encryptedBody) throw new PrivateVideoJobError();
          // Journal WRITING before network I/O. After a crash only HEAD/GET may run.
          if (artifact.status === "PREPARED") await tx.privateVideoArtifact.update({ where: { id: artifact.id }, data: { status: "WRITING" } });
          return { artifact, wasPrepared: artifact.status === "PREPARED" };
        });
        if (!pending) continue;
        const prepared = { reference: pending.artifact.preparedReference, encryptedBody: Buffer.from(pending.artifact.encryptedBody!) } as PreparedPrivateVideoArtifact;
        const reference = pending.wasPrepared ? await store.write(prepared) : await store.confirm(prepared);
        const { versionId, ...metadata } = parsePrivateVideoArtifactReference(reference);
        if (!versionId || !isDeepStrictEqual(metadata, prepared.reference)) throw new PrivateVideoJobError();
        const verified = await store.read(reference);
        if (hash(verified) !== prepared.reference.plaintextSha256) throw new PrivateVideoJobError();
        await locked(jobId, async (tx, job, now) => {
          if (!owns(job, now)) throw new PrivateVideoJobError();
          const changed = await tx.privateVideoArtifact.updateMany({ where: { id: pending.artifact.id, jobId, status: "WRITING" }, data: { status: "STORED", storedReference: reference } });
          if (changed.count !== 1) throw new PrivateVideoJobError();
          await tx.auditLog.create({ data: { actorId: job.actorId, action: "private_video.artifact_stored", entityType: "PrivateVideoJob", entityId: jobId, metadata: { role } } });
        });
      }
      return await locked(jobId, async (tx, job, now) => {
        if (!owns(job, now)) throw new PrivateVideoJobError();
        const artifacts = await tx.privateVideoArtifact.findMany({ where: { jobId } });
        if (artifacts.length !== 3 || roles.some(role => !artifacts.some(row => row.role === role && row.status === "STORED" && row.storedReference))) throw new PrivateVideoJobError();
        for (const artifact of artifacts) {
          const reference = parsePrivateVideoArtifactReference(artifact.storedReference);
          const { versionId, ...metadata } = reference;
          if (!versionId || reference.role !== artifact.role || !isDeepStrictEqual(metadata, artifact.preparedReference)) throw new PrivateVideoJobError();
        }
        await tx.privateVideoJob.update({ where: { id: jobId }, data: { status: "STORED", leaseToken: null, leaseExpiresAt: null } });
        await tx.privateVideoArtifact.updateMany({ where: { jobId }, data: { encryptedBody: null } });
        await tx.auditLog.create({ data: { actorId: job.actorId, action: "private_video.bundle_stored", entityType: "PrivateVideoJob", entityId: jobId } });
        return { jobId, state: "STORED" as const };
      });
    } catch {
      // Preserve encrypted candidates and exact object references. Never DELETE or
      // repeat an uncertain PUT, and never let an expired worker commit success.
      const marked = await db.$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "PrivateVideoJob" WHERE "id" = ${jobId} FOR UPDATE`;
        const changed = await tx.privateVideoJob.updateMany({ where: { id: jobId, leaseToken: token, status: "PROCESSING" }, data: { status: "REVIEW_REQUIRED", leaseToken: null, leaseExpiresAt: null } });
        if (changed.count) await tx.auditLog.create({ data: { action: "private_video.review_required", entityType: "PrivateVideoJob", entityId: jobId } });
        return changed.count;
      });
      return { jobId, state: marked ? "REVIEW_REQUIRED" : "BUSY" };
    }
  }
  async function safe<T>(operation: () => Promise<T>) {
    try { return await operation(); }
    catch (error) { if (error instanceof PrivateVideoJobError) throw error; throw new PrivateVideoJobError(); }
  }
  return { stage: (input: Parameters<typeof stage>[0], recordProcessing?: Parameters<typeof stage>[1]) => safe(() => stage(input, recordProcessing)), run: (jobId: string) => safe(() => run(jobId)) };
}
