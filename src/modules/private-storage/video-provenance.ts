import "server-only";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { parsePrivateVideoArtifactReference } from "./video-artifacts";

export const videoManifestSchema = z.object({
  profile: z.literal("inspection-video-v1"),
  originalSha256: z.string().regex(/^[a-f0-9]{64}$/), videoSha256: z.string().regex(/^[a-f0-9]{64}$/), posterSha256: z.string().regex(/^[a-f0-9]{64}$/),
  originalBytes: z.number().int().min(16).max(30 * 1024 * 1024), videoBytes: z.number().int().min(16).max(8 * 1024 * 1024), posterBytes: z.number().int().min(3).max(512 * 1024),
  durationMs: z.number().int().min(200).max(60000), width: z.number().int().min(16).max(1280), height: z.number().int().min(16).max(720), audio: z.boolean(),
}).strict();
export function videoManifestHash(value: unknown) { return createHash("sha256").update(JSON.stringify(videoManifestSchema.parse(value))).digest("hex"); }
export function matchVideoManifest(manifest: z.infer<typeof videoManifestSchema>, profile: unknown, artifacts: Array<{ role: string; preparedReference: unknown }>) {
  const { videoSha256, posterSha256, originalBytes, videoBytes, posterBytes, ...metadata } = manifest;
  if (!isDeepStrictEqual(metadata, profile) || artifacts.length !== 3) throw new Error("PRIVATE_VIDEO_PROOF_UNAVAILABLE");
  for (const [role, sha256, size] of [["original", manifest.originalSha256, originalBytes], ["video", videoSha256, videoBytes], ["poster", posterSha256, posterBytes]] as const) {
    const matches = artifacts.filter(row => row.role === role);
    if (matches.length !== 1) throw new Error("PRIVATE_VIDEO_PROOF_UNAVAILABLE");
    const ref = parsePrivateVideoArtifactReference({ ...(matches[0].preparedReference as object), versionId: "pending" });
    if (ref.role !== role || ref.plaintextSha256 !== sha256 || ref.sizeBytes !== size) throw new Error("PRIVATE_VIDEO_PROOF_UNAVAILABLE");
  }
}

/** Called only by the verified processor handoff, in the same staging transaction.
 * This is a local provenance receipt, not a provider-signed scan certificate. */
export async function recordVideoProcessingProof(tx: Prisma.TransactionClient, input: { jobId: string; actorId: string; sessionId: string; manifest: z.infer<typeof videoManifestSchema> }) {
  const manifest = videoManifestSchema.parse(input.manifest), manifestSha256 = videoManifestHash(manifest);
  const job = await tx.privateVideoJob.findUniqueOrThrow({ where: { id: input.jobId }, include: { artifacts: true, processingProof: true } });
  if (job.actorId !== input.actorId) throw new Error("PRIVATE_VIDEO_PROOF_UNAVAILABLE");
  matchVideoManifest(manifest, job.profile, job.artifacts);
  if (job.processingProof) {
    if (job.processingProof.manifestSha256 !== manifestSha256 || !isDeepStrictEqual(job.processingProof.manifest, manifest)) throw new Error("PRIVATE_VIDEO_PROOF_UNAVAILABLE");
    return;
  }
  const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp()::timestamp(3) AS "now"`;
  if (!clock?.now || clock.now < job.createdAt) throw new Error("PRIVATE_VIDEO_PROOF_UNAVAILABLE");
  await tx.privateVideoProcessingProof.create({ data: { jobId: job.id, sessionId: z.uuid().parse(input.sessionId), manifest, manifestSha256, verifiedAt: clock.now } });
  await tx.auditLog.create({ data: { actorId: input.actorId, action: "private_video.processing_verified", entityType: "PrivateVideoJob", entityId: job.id, metadata: { profile: manifest.profile } } });
}
