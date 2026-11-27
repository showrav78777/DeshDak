import "server-only";
import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { createPrivateVideoJobs } from "./video-jobs";
import { authorizeVideoStaging } from "./video-authorization";
import { recordVideoProcessingProof, matchVideoManifest, videoManifestSchema, videoManifestHash } from "./video-provenance";
import type { createPrivateVideoArtifactStore } from "./video-artifacts";
import type { createPrivateInspectionVideoProcessor } from "./video-processing";

const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const schema = z.object({ actorId: z.uuid(), sessionId: z.uuid(), packageId: z.uuid(), requestKey: z.string().regex(/^[A-Za-z0-9:_-]{16,128}$/) }).strict();
export class PrivateVideoIntakeError extends Error {
  constructor(code: "PRIVATE_VIDEO_INTAKE_UNAVAILABLE" | "PRIVATE_VIDEO_INTAKE_ACCESS_CHANGED" | "PRIVATE_VIDEO_INTAKE_CONFLICT" = "PRIVATE_VIDEO_INTAKE_UNAVAILABLE") { super(code); }
}

/** Internal handoff; actor/session IDs must come from verified server authentication.
 * No HTTP route, scan certificate or evidence release is provided here. */
export function createPrivateVideoIntake(db: PrismaClient, store: ReturnType<typeof createPrivateVideoArtifactStore>, processVideo: ReturnType<typeof createPrivateInspectionVideoProcessor>, guard?: (tx: Prisma.TransactionClient) => Promise<boolean>) {
  const authorize = async (tx: Prisma.TransactionClient, scope: z.infer<typeof schema>) => await authorizeVideoStaging(tx, scope) && (!guard || await guard(tx));
  return { async submit(input: { actorId: string; sessionId: string; packageId: string; requestKey: string; file: File }) {
    let auditScope: z.infer<typeof schema> | undefined;
    try {
      const scope = schema.parse({ actorId: input.actorId, sessionId: input.sessionId, packageId: input.packageId, requestKey: input.requestKey });
      auditScope = scope;
      if (!(input.file instanceof File) || input.file.type !== "video/mp4" || input.file.size < 16 || input.file.size > 30 * 1024 * 1024) throw new PrivateVideoIntakeError();
      if (!await db.$transaction(tx => authorize(tx, scope))) throw new PrivateVideoIntakeError("PRIVATE_VIDEO_INTAKE_ACCESS_CHANGED");
      const original = Buffer.from(await input.file.arrayBuffer());
      if (original.length !== input.file.size || original.toString("ascii", 4, 8) !== "ftyp") throw new PrivateVideoIntakeError();
      const originalSha256 = hash(original);
      const idempotencyKey = hash(Buffer.from(JSON.stringify(["inspection-video-intake:v1", scope.requestKey])));
      const jobs = createPrivateVideoJobs(db, store, (tx, actorId, packageId) => authorize(tx, { ...scope, actorId, packageId }));
      const existing = await db.privateVideoJob.findUnique({ where: { actorId_idempotencyKey: { actorId: scope.actorId, idempotencyKey } }, include: { processingProof: true, artifacts: { select: { role: true, preparedReference: true } } } });
      let jobId: string;
      if (existing) {
        const profile = existing.profile as { originalSha256?: string };
        if (existing.packageId !== scope.packageId || existing.storageNamespace !== store.namespace || profile?.originalSha256 !== originalSha256) throw new PrivateVideoIntakeError("PRIVATE_VIDEO_INTAKE_CONFLICT");
        if (!existing.processingProof) throw new PrivateVideoIntakeError();
        const manifest = videoManifestSchema.parse(existing.processingProof.manifest);
        if (videoManifestHash(manifest) !== existing.processingProof.manifestSha256 || manifest.originalBytes !== original.length) throw new PrivateVideoIntakeError();
        matchVideoManifest(manifest, existing.profile, existing.artifacts);
        jobId = existing.id;
      } else {
        const result = await processVideo(Buffer.from(original));
        if (result.originalSha256 !== originalSha256 || result.video.sha256 !== hash(result.video.bytes) || result.poster.sha256 !== hash(result.poster.bytes)) throw new PrivateVideoIntakeError();
        const { video, poster, ...profile } = result;
        const manifest = videoManifestSchema.parse({ ...profile, videoSha256: video.sha256, posterSha256: poster.sha256, originalBytes: original.length, videoBytes: video.bytes.length, posterBytes: poster.bytes.length });
        ({ jobId } = await jobs.stage({ actorId: scope.actorId, packageId: scope.packageId, idempotencyKey, profile, original, video: video.bytes, poster: poster.bytes }, (tx, id) => recordVideoProcessingProof(tx, { jobId: id, actorId: scope.actorId, sessionId: scope.sessionId, manifest })));
      }
      const stored = await jobs.run(jobId);
      if (!await db.$transaction(tx => authorize(tx, scope))) throw new PrivateVideoIntakeError("PRIVATE_VIDEO_INTAKE_ACCESS_CHANGED");
      // Only the opaque job state leaves this internal handoff. Storage completion
      // does not publish the original or approve an InspectionEvidence record.
      return stored;
    } catch (error) {
      if (auditScope) {
        try {
          const actor = await db.user.findUnique({ where: { id: auditScope.actorId }, select: { id: true } });
          await db.auditLog.create({ data: { actorId: actor?.id ?? null, action: "private_video.intake_failed", entityType: "Package", entityId: auditScope.packageId, metadata: { reason: error instanceof PrivateVideoIntakeError && error.message === "PRIVATE_VIDEO_INTAKE_ACCESS_CHANGED" ? "ACCESS_CHANGED" : "UNAVAILABLE" } } });
        } catch { /* Failure to journal a denial never permits intake. */ }
      }
      if (error instanceof PrivateVideoIntakeError) throw error;
      throw new PrivateVideoIntakeError();
    }
  } };
}
