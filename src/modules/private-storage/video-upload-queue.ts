import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient, PrivateVideoUpload } from "@prisma/client";
import { z } from "zod";
import { authorizeVideoStaging } from "./video-authorization";
import { createPrivateVideoIntake } from "./video-intake";
import type { createPrivateVideoArtifactStore } from "./video-artifacts";
import type { createPrivateInspectionVideoProcessor } from "./video-processing";

const scopeSchema = z.object({ actorId: z.uuid(), sessionId: z.uuid(), packageId: z.uuid(), requestKey: z.string().regex(/^[A-Za-z0-9:_-]{16,128}$/) }).strict();
type Scope = z.infer<typeof scopeSchema>;
type Tx = Prisma.TransactionClient;
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const metadata = { id: true, actorId: true, packageId: true, requestKey: true, keyScope: true, originalSha256: true, sizeBytes: true, sessionId: true, status: true, attempts: true, leaseToken: true, leaseExpiresAt: true, storedJobId: true, createdAt: true, updatedAt: true } as const;
export class PrivateVideoQueueError extends Error {
  constructor() { super("PRIVATE_VIDEO_QUEUE_UNAVAILABLE"); }
}
async function clock(tx: Tx) {
  const [row] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp()::timestamp(3) AS "now"`;
  if (!(row?.now instanceof Date) || !Number.isFinite(row.now.getTime())) throw new PrivateVideoQueueError();
  return row.now;
}

const maxConcurrentVideoRequests = 2;
let activeVideoRequests = 0;

const maxVideoBytes = 30 * 1024 * 1024;

async function readVideoRequest(request: Request) {
  const type = request.headers.get("content-type")?.trim().toLowerCase();
  const encoding = request.headers.get("content-encoding")?.trim().toLowerCase();
  const length = request.headers.get("content-length");
  if (type !== "video/mp4" || (encoding && encoding !== "identity") || !request.body) throw new PrivateVideoQueueError();
  if (length !== null && (!/^\d{1,8}$/.test(length) || Number(length) < 16 || Number(length) > maxVideoBytes)) throw new PrivateVideoQueueError();

  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]);
  signal.throwIfAborted();
  const reader = request.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let bytes = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) {
      const part = await reader.read();
      signal.throwIfAborted();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maxVideoBytes || (length !== null && bytes > Number(length))) throw new PrivateVideoQueueError();
      chunks.push(new Uint8Array(part.value));
    }
    if (bytes < 16 || (length !== null && bytes !== Number(length))) throw new PrivateVideoQueueError();
    return new File(chunks, "inspection.mp4", { type: "video/mp4" });
  } finally {
    signal.removeEventListener("abort", cancel);
    cancel();
    reader.releaseLock();
  }
}

/** Internal bounded queue. No scheduler, public transport or release authority. */
export function createPrivateVideoUploadQueue(db: PrismaClient, store: ReturnType<typeof createPrivateVideoArtifactStore>, processor: ReturnType<typeof createPrivateInspectionVideoProcessor>, encryptionKey: Buffer) {
  const key = Buffer.from(encryptionKey);
  if (key.length !== 32) throw new PrivateVideoQueueError();
  const keyScope = createHmac("sha256", key).update(`deshdak:video-upload:v1:${store.namespace}`).digest("hex");
  const dto = (row: { id: string; status: string }) => ({ uploadId: row.id, state: row.status });
  const aad = (row: { id: string; actorId: string; packageId: string; requestKey: string; originalSha256: string; sizeBytes: number }) => Buffer.from(JSON.stringify(["deshdak:video-upload:v1", keyScope, row.id, row.actorId, row.packageId, row.requestKey, row.originalSha256, row.sizeBytes]));
  async function authorize(tx: Tx, scope: Scope) {
    if (!await authorizeVideoStaging(tx, scope)) throw new PrivateVideoQueueError();
  }
  async function locked<T>(scope: Scope, id: string, callback: (tx: Tx, row: Prisma.PrivateVideoUploadGetPayload<{ select: typeof metadata }>, now: Date) => Promise<T>, serialize = false) {
    return db.$transaction(async tx => {
      if (serialize) await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(281126, 1)`;
      await authorize(tx, scope);
      await tx.$queryRaw`SELECT "id" FROM "PrivateVideoUpload" WHERE "id" = ${id} FOR UPDATE`;
      const row = await tx.privateVideoUpload.findUnique({ where: { id }, select: metadata });
      if (!row || row.actorId !== scope.actorId || row.packageId !== scope.packageId || row.requestKey !== scope.requestKey || row.keyScope !== keyScope) throw new PrivateVideoQueueError();
      const result = await callback(tx, row, await clock(tx));
      await authorize(tx, scope); return result;
    });
  }
  async function failed(actorId?: string) {
    try { await db.auditLog.create({ data: { actorId, action: "private_video.upload_queue_denied", entityType: "PrivateVideoUpload", metadata: { outcome: "UNAVAILABLE" } } }); }
    catch { /* Denials never grant processing authority. */ }
  }
  function decrypt(row: PrivateVideoUpload) {
    if (row.keyScope !== keyScope || row.iv.length !== 12 || row.encryptedBody.length !== row.sizeBytes + 16) throw new PrivateVideoQueueError();
    const body = Buffer.from(row.encryptedBody), decoder = createDecipheriv("aes-256-gcm", key, row.iv);
    decoder.setAAD(aad(row)); decoder.setAuthTag(body.subarray(-16));
    const raw = Buffer.concat([decoder.update(body.subarray(0, -16)), decoder.final()]);
    if (raw.length !== row.sizeBytes || digest(raw) !== row.originalSha256 || raw.toString("ascii", 4, 8) !== "ftyp") throw new PrivateVideoQueueError();
    return raw;
  }
  const queue = {
    async enqueueRequest(input: Scope, request: Request) {
      if (activeVideoRequests >= maxConcurrentVideoRequests) throw new PrivateVideoQueueError();
      activeVideoRequests++;
      try {
        const scope = scopeSchema.parse(input);
        await db.$transaction(tx => authorize(tx, scope));
        const file = await readVideoRequest(request);
        return await queue.enqueue({ ...scope, file });
      } catch {
        await failed();
        throw new PrivateVideoQueueError();
      } finally {
        activeVideoRequests--;
      }
    },
    async enqueue(input: Scope & { file: File }) {
      let actorId: string | undefined;
      try {
        const scope = scopeSchema.parse({ actorId: input.actorId, sessionId: input.sessionId, packageId: input.packageId, requestKey: input.requestKey }); actorId = scope.actorId;
        if (!(input.file instanceof File) || input.file.type !== "video/mp4" || input.file.size < 16 || input.file.size > maxVideoBytes) throw new PrivateVideoQueueError();
        await db.$transaction(tx => authorize(tx, scope));
        const raw = Buffer.from(await input.file.arrayBuffer());
        if (raw.length !== input.file.size || raw.toString("ascii", 4, 8) !== "ftyp") throw new PrivateVideoQueueError();
        return await db.$transaction(async tx => {
          // Serialize capacity reservations before account/package locks.
          await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(281126, 1)`;
          await authorize(tx, scope);
          const existing = await tx.privateVideoUpload.findUnique({ where: { actorId_requestKey: { actorId: scope.actorId, requestKey: scope.requestKey } }, select: metadata });
          if (existing) {
            if (existing.packageId !== scope.packageId || existing.keyScope !== keyScope || existing.originalSha256 !== digest(raw) || existing.sizeBytes !== raw.length) throw new PrivateVideoQueueError();
            return dto(existing);
          }
          // Count preserved bytes too: cancellation/completion cannot bypass the cap.
          const [global, own] = await Promise.all([tx.privateVideoUpload.aggregate({ _count: { id: true }, _sum: { sizeBytes: true } }), tx.privateVideoUpload.count({ where: { actorId: scope.actorId } })]);
          if (global._count.id >= 40 || own >= 20 || (global._sum.sizeBytes ?? 0) + raw.length > 300 * 1024 * 1024) throw new PrivateVideoQueueError();
          const row = { id: randomUUID(), actorId: scope.actorId, packageId: scope.packageId, requestKey: scope.requestKey, originalSha256: digest(raw), sizeBytes: raw.length }, iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
          cipher.setAAD(aad(row)); const encryptedBody = Buffer.concat([cipher.update(raw), cipher.final(), cipher.getAuthTag()]);
          const saved = await tx.privateVideoUpload.create({ data: { ...row, keyScope, iv, encryptedBody, sessionId: scope.sessionId, createdAt: await clock(tx) }, select: metadata });
          await tx.auditLog.create({ data: { actorId, action: "private_video.upload_queued", entityType: "PrivateVideoUpload", entityId: row.id, metadata: { outcome: "QUEUED" } } });
          await authorize(tx, scope); return dto(saved);
        });
      } catch { await failed(actorId); throw new PrivateVideoQueueError(); }
    },
    // Recover an acknowledgement or poll progress without resending media.
    async status(input: Scope) {
      let actorId: string | undefined;
      try {
        const scope = scopeSchema.parse(input);
        actorId = scope.actorId;
        return await db.$transaction(async tx => {
          await authorize(tx, scope);
          const row = await tx.privateVideoUpload.findUnique({
            where: { actorId_requestKey: { actorId: scope.actorId, requestKey: scope.requestKey } },
            select: { id: true, status: true, packageId: true, keyScope: true },
          });
          if (!row || row.packageId !== scope.packageId || row.keyScope !== keyScope) throw new PrivateVideoQueueError();
          await authorize(tx, scope);
          return dto(row);
        });
      } catch {
        await failed(actorId);
        throw new PrivateVideoQueueError();
      }
    },
    async cancel(input: Scope & { uploadId: string }) {
      let actorId: string | undefined;
      try {
        const { uploadId, ...raw } = input, scope = scopeSchema.parse(raw); actorId = scope.actorId; z.uuid().parse(uploadId);
        return await locked(scope, uploadId, async (tx, row) => {
          if (row.status === "CANCELLED") return dto(row);
          if (!["QUEUED", "PROCESSING"].includes(row.status)) throw new PrivateVideoQueueError();
          await tx.privateVideoUpload.update({ where: { id: uploadId }, data: { status: "CANCELLED", leaseToken: null, leaseExpiresAt: null } });
          await tx.auditLog.create({ data: { actorId, action: "private_video.upload_cancelled", entityType: "PrivateVideoUpload", entityId: uploadId, metadata: { outcome: "PRESERVED" } } });
          return { uploadId, state: "CANCELLED" };
        });
      } catch { await failed(actorId); throw new PrivateVideoQueueError(); }
    },
    async run(input: Scope & { uploadId: string }) {
      let actorId: string | undefined;
      try {
        const { uploadId, ...raw } = input, scope = scopeSchema.parse(raw); actorId = scope.actorId; z.uuid().parse(uploadId);
        const token = randomUUID();
        const claimed = await locked(scope, uploadId, async (tx, row, now) => {
          if (["STORED", "CANCELLED", "REVIEW_REQUIRED"].includes(row.status)) return dto(row);
          if (row.status === "PROCESSING" && row.leaseExpiresAt && row.leaseExpiresAt > now) return { uploadId, state: "BUSY" };
          if (row.attempts >= 5) { await tx.auditLog.create({ data: { actorId, action: "private_video.upload_result", entityType: "PrivateVideoUpload", entityId: uploadId, metadata: { outcome: "REVIEW_REQUIRED" } } }); await tx.privateVideoUpload.update({ where: { id: uploadId }, data: { status: "REVIEW_REQUIRED", leaseToken: null, leaseExpiresAt: null } }); return { uploadId, state: "REVIEW_REQUIRED" }; }
          if (await tx.privateVideoUpload.count({ where: { id: { not: uploadId }, status: "PROCESSING", leaseExpiresAt: { gt: now } } })) return { uploadId, state: "BUSY" };
          await tx.privateVideoUpload.update({ where: { id: uploadId }, data: { status: "PROCESSING", attempts: { increment: 1 }, sessionId: scope.sessionId, leaseToken: token, leaseExpiresAt: new Date(now.getTime() + 5 * 60000) } });
          await tx.auditLog.create({ data: { actorId, action: "private_video.upload_claimed", entityType: "PrivateVideoUpload", entityId: uploadId, metadata: { attempt: row.attempts + 1 } } });
          return null;
        }, true);
        if (claimed) return claimed;
        const guard = async (tx: Tx) => {
          await tx.$queryRaw`SELECT "id" FROM "PrivateVideoUpload" WHERE "id" = ${uploadId} FOR UPDATE`;
          const row = await tx.privateVideoUpload.findUnique({ where: { id: uploadId }, select: metadata }), now = await clock(tx);
          if (!row || row.status !== "PROCESSING" || row.leaseToken !== token || !row.leaseExpiresAt || row.leaseExpiresAt <= now || row.sessionId !== scope.sessionId || row.keyScope !== keyScope) return false;
          // Associate staging atomically before its first cloud write. Cancellation
          // must also fence later direct job recovery, evidence binding and preview.
          const idempotencyKey = digest(Buffer.from(JSON.stringify(["inspection-video-intake:v1", scope.requestKey])));
          const job = await tx.privateVideoJob.findUnique({ where: { actorId_idempotencyKey: { actorId: scope.actorId, idempotencyKey } }, select: { id: true, packageId: true } });
          if (job) {
            if (job.packageId !== scope.packageId || row.storedJobId && row.storedJobId !== job.id) return false;
            if (!row.storedJobId) await tx.privateVideoUpload.update({ where: { id: uploadId }, data: { storedJobId: job.id } });
          }
          return true;
        };
        try {
          const row = await db.privateVideoUpload.findUniqueOrThrow({ where: { id: uploadId } }), bytes = decrypt(row);
          const result = await createPrivateVideoIntake(db, store, processor, guard).submit({ ...scope, file: new File([new Uint8Array(bytes)], "inspection.mp4", { type: "video/mp4" }) });
          return await locked(scope, uploadId, async (tx, current, now) => {
            if (current.leaseToken !== token || current.status !== "PROCESSING" || !current.leaseExpiresAt || current.leaseExpiresAt <= now) throw new PrivateVideoQueueError();
            const state = result.state === "STORED" ? "STORED" : result.state === "BUSY" ? "QUEUED" : "REVIEW_REQUIRED";
            await tx.privateVideoUpload.update({ where: { id: uploadId }, data: { status: state, storedJobId: result.jobId, leaseToken: null, leaseExpiresAt: null } });
            await tx.auditLog.create({ data: { actorId, action: "private_video.upload_result", entityType: "PrivateVideoUpload", entityId: uploadId, metadata: { outcome: state } } });
            return { uploadId, state };
          });
        } catch {
          // A stale worker cannot reset or acknowledge its replacement/canceller.
          await db.$transaction(async tx => {
            await tx.$queryRaw`SELECT "id" FROM "PrivateVideoUpload" WHERE "id" = ${uploadId} FOR UPDATE`;
            const row = await tx.privateVideoUpload.findUnique({ where: { id: uploadId }, select: metadata });
            if (row?.status === "PROCESSING" && row.leaseToken === token) {
              await tx.privateVideoUpload.update({ where: { id: uploadId }, data: { status: "REVIEW_REQUIRED", leaseToken: null, leaseExpiresAt: null } });
              await tx.auditLog.create({ data: { actorId, action: "private_video.upload_result", entityType: "PrivateVideoUpload", entityId: uploadId, metadata: { outcome: "REVIEW_REQUIRED" } } });
            }
          });
          throw new PrivateVideoQueueError();
        }
      } catch { await failed(actorId); throw new PrivateVideoQueueError(); }
    },
  };
  return queue;
}
