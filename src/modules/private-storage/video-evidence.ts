import "server-only";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { authorizeVideoStaging } from "./video-authorization";
import { parsePrivateVideoArtifactReference, type createPrivateVideoArtifactStore } from "./video-artifacts";
import { matchVideoManifest, videoManifestHash, videoManifestSchema } from "./video-provenance";

const request = z.object({ actorId: z.uuid(), sessionId: z.uuid(), jobId: z.uuid() }).strict();
type Input = z.infer<typeof request>;
export class PrivateVideoBindingError extends Error { constructor() { super("PRIVATE_VIDEO_BINDING_UNAVAILABLE"); } }

/** Verified server authentication supplies actor/session IDs. Binding stays STAGED. */
export function createPrivateVideoEvidence(db: PrismaClient, store: Pick<ReturnType<typeof createPrivateVideoArtifactStore>, "namespace" | "read">) {
  async function authorize(tx: Prisma.TransactionClient, input: Input) {
    const scope = await tx.privateVideoJob.findUnique({ where: { id: input.jobId }, select: { actorId: true, packageId: true } });
    if (!scope || scope.actorId !== input.actorId || !await authorizeVideoStaging(tx, { ...input, packageId: scope.packageId })) throw new PrivateVideoBindingError();
    await tx.$queryRaw`SELECT "id" FROM "PrivateVideoJob" WHERE "id" = ${input.jobId} FOR UPDATE`;
    if (await tx.privateVideoQuarantine.findUnique({ where: { jobId: input.jobId }, select: { id: true } })) throw new PrivateVideoBindingError();
    if (await tx.privateVideoUpload.findFirst({ where: { storedJobId: input.jobId, status: { not: "STORED" } }, select: { id: true } })) throw new PrivateVideoBindingError();
    const job = await tx.privateVideoJob.findUniqueOrThrow({ where: { id: input.jobId }, include: { artifacts: true, processingProof: true, evidenceLink: { include: { evidence: true } } } });
    if (job.actorId !== input.actorId || job.packageId !== scope.packageId || job.status !== "STORED" || job.leaseToken || job.leaseExpiresAt || job.storageNamespace !== store.namespace || !job.processingProof) throw new PrivateVideoBindingError();
    const manifest = videoManifestSchema.parse(job.processingProof.manifest);
    if (videoManifestHash(manifest) !== job.processingProof.manifestSha256) throw new PrivateVideoBindingError();
    matchVideoManifest(manifest, job.profile, job.artifacts);
    const refs = ["original", "video", "poster"].map(role => {
      const artifact = job.artifacts.find(row => row.role === role);
      if (!artifact || artifact.status !== "STORED" || artifact.encryptedBody) throw new PrivateVideoBindingError();
      const ref = parsePrivateVideoArtifactReference(artifact.storedReference);
      const { versionId, ...metadata } = ref;
      if (!versionId || ref.role !== role || !isDeepStrictEqual(metadata, artifact.preparedReference)) throw new PrivateVideoBindingError();
      return ref;
    });
    const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp()::timestamp(3) AS "now"`;
    if (job.processingProof.verifiedAt < job.createdAt || job.processingProof.verifiedAt > clock.now) throw new PrivateVideoBindingError();
    const link = job.evidenceLink;
    if (link && (link.processingProofId !== job.processingProof.id || link.status !== "STAGED" || link.linkedById !== input.actorId || link.evidence.uploadedById !== input.actorId || link.evidence.packageId !== job.packageId || link.evidence.mediaKind !== "VIDEO" || link.evidence.mimeType !== "video/mp4" || link.evidence.sha256 !== refs[1].plaintextSha256 || link.evidence.sizeBytes !== refs[1].sizeBytes || link.evidence.ciphertext || link.evidence.iv || link.evidence.authTag)) throw new PrivateVideoBindingError();
    if (!await authorizeVideoStaging(tx, { ...input, packageId: job.packageId })) throw new PrivateVideoBindingError();
    return { packageId: job.packageId, refs, proofId: job.processingProof.id, manifestSha256: job.processingProof.manifestSha256, link };
  }
  return { async bind(raw: Input) {
    let input: Input | undefined;
    try {
      input = request.parse(raw);
      const before = await db.$transaction(tx => authorize(tx, input!));
      // Exact versions must still be readable and authentic. No lock is held
      // during storage I/O, and grants/proof/references are checked again afterward.
      for (const ref of before.refs) {
        const bytes = await store.read(ref);
        if (bytes.length !== ref.sizeBytes || createHash("sha256").update(bytes).digest("hex") !== ref.plaintextSha256) throw new PrivateVideoBindingError();
      }
      return await db.$transaction(async tx => {
        const after = await authorize(tx, input!);
        if (after.proofId !== before.proofId || after.packageId !== before.packageId || after.manifestSha256 !== before.manifestSha256 || !isDeepStrictEqual(after.refs, before.refs)) throw new PrivateVideoBindingError();
        if (after.link) return { evidenceId: after.link.evidenceId, state: "STAGED" as const, replayed: true };
        const video = after.refs[1];
        const evidence = await tx.inspectionEvidence.create({ data: { packageId: after.packageId, uploadedById: input!.actorId, mediaKind: "VIDEO", mimeType: "video/mp4", sizeBytes: video.sizeBytes, sha256: video.plaintextSha256 } });
        await tx.privateVideoEvidenceLink.create({ data: { jobId: input!.jobId, processingProofId: after.proofId, evidenceId: evidence.id, linkedById: input!.actorId } });
        await tx.auditLog.create({ data: { actorId: input!.actorId, action: "private_video.evidence_staged", entityType: "PrivateVideoJob", entityId: input!.jobId, metadata: { evidenceId: evidence.id, state: "STAGED" } } });
        if (!await authorizeVideoStaging(tx, { ...input!, packageId: after.packageId })) throw new PrivateVideoBindingError();
        return { evidenceId: evidence.id, state: "STAGED" as const, replayed: false };
      });
    } catch {
      if (input) {
        try {
          const actor = await db.user.findUnique({ where: { id: input.actorId }, select: { id: true } });
          await db.auditLog.create({ data: { actorId: actor?.id ?? null, action: "private_video.binding_blocked", entityType: "PrivateVideoJob", entityId: input.jobId, metadata: { outcome: "UNAVAILABLE" } } });
        } catch { /* A failed denial audit never permits binding. */ }
      }
      throw new PrivateVideoBindingError();
    }
  } };
}
