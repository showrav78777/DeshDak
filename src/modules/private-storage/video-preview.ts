import "server-only";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { lockActiveAccount } from "@/modules/auth/account-mutation";
import { parsePrivateVideoArtifactReference, type createPrivateVideoArtifactStore } from "./video-artifacts";
import { matchVideoManifest, videoManifestHash, videoManifestSchema } from "./video-provenance";
import { privateVideoByteRange } from "./video-byte-range";

const schema = z.object({ sessionId: z.uuid(), evidenceId: z.uuid(), artifact: z.enum(["video", "poster"]), method: z.enum(["GET", "HEAD"]).default("GET"), range: z.string().nullable().optional(), ifRange: z.string().nullable().optional() }).strict();
type Input = z.infer<typeof schema>;
type Request = Omit<Input, "method"> & { method?: string };
type ErrorCode = "PRIVATE_VIDEO_PREVIEW_DENIED" | "PRIVATE_VIDEO_PREVIEW_UNAVAILABLE" | "PRIVATE_VIDEO_NOT_PUBLISHED" | "PRIVATE_VIDEO_RANGE_INVALID" | "PRIVATE_VIDEO_METHOD_NOT_ALLOWED";
export class PrivateVideoPreviewError extends Error {
  readonly code: ErrorCode;
  readonly authorizedTotal?: number;
  constructor(code: ErrorCode = "PRIVATE_VIDEO_PREVIEW_UNAVAILABLE", authorizedTotal?: number) {
    super(code); this.code = code; this.authorizedTotal = authorizedTotal;
  }
}
const deny = () => new PrivateVideoPreviewError("PRIVATE_VIDEO_PREVIEW_DENIED");

/** Internal staff preview only. Verified server authentication supplies sessionId.
 * No runtime route/publication switch is installed; originals are never selectable. */
export function createPrivateVideoPreview(db: PrismaClient, store: Pick<ReturnType<typeof createPrivateVideoArtifactStore>, "namespace" | "read">) {
  async function authorize(tx: Prisma.TransactionClient, input: Input) {
    const initial = await tx.authSession.findUnique({ where: { id: input.sessionId }, select: { userId: true } });
    if (!initial || !await lockActiveAccount(tx, initial.userId, input.sessionId)) throw deny();
    const target = await tx.inspectionEvidence.findUnique({ where: { id: input.evidenceId }, select: { packageId: true, mediaKind: true, privateVideoLink: { select: { id: true } } } });
    if (!target || target.mediaKind !== "VIDEO" || !target.privateVideoLink) throw deny();
    const scope = await tx.package.findUnique({ where: { id: target.packageId }, select: { orderId: true } });
    if (!scope) throw deny();
    // Match order mutations: order before package. Never hold these locks over I/O.
    await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${scope.orderId} FOR SHARE`;
    await tx.$queryRaw`SELECT "id" FROM "Package" WHERE "id" = ${target.packageId} FOR SHARE`;
    const parcel = await tx.package.findUniqueOrThrow({ where: { id: target.packageId } });
    const order = await tx.order.findUniqueOrThrow({ where: { id: scope.orderId }, select: { customerId: true } });
    if (parcel.orderId !== scope.orderId || !parcel.isOutboundActive || parcel.status === "EXPECTED") throw deny();
    await tx.$queryRaw`SELECT "roleId" FROM "UserRole" WHERE "userId" = ${initial.userId} FOR SHARE`;
    const roles = (await tx.userRole.findMany({ where: { userId: initial.userId }, select: { role: { select: { code: true } } } })).map(row => row.role.code);
    const session = await tx.authSession.findUniqueOrThrow({ where: { id: input.sessionId } });
    let assigned = false;
    if (parcel.warehouseId && session.portal !== "admin") assigned = (await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "WarehouseStaffAssignment" WHERE "userId" = ${initial.userId} AND "warehouseId" = ${parcel.warehouseId} AND "isActive" = true FOR SHARE`).length > 0;
    async function current() {
      const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp()::timestamp(3) AS "now"`;
      if (!session || session.revokedAt || session.expiresAt <= clock.now || session.mfaVerifiedAt && session.mfaVerifiedAt > clock.now) throw deny();
      return clock.now;
    }
    const now = await current();
    if (session.portal === "customer") {
      if (order.customerId !== initial.userId || !roles.some(role => ["customer_personal", "customer_business"].includes(role))) throw deny();
      // Ownership alone cannot publish STAGED evidence. No customer byte/size read.
      throw new PrivateVideoPreviewError("PRIVATE_VIDEO_NOT_PUBLISHED");
    }
    const admin = session.portal === "admin" && roles.includes("admin") && session.mfaVerifiedAt && now.getTime() - session.mfaVerifiedAt.getTime() <= 15 * 60000;
    const worker = assigned && (session.portal === "inspector" && roles.includes("inspector") || session.portal === "warehouse" && roles.includes("warehouse_worker"));
    if (!admin && !worker) throw deny();
    const initialLink = await tx.privateVideoEvidenceLink.findUnique({ where: { evidenceId: input.evidenceId }, select: { id: true, jobId: true, processingProofId: true } });
    if (!initialLink) throw deny();
    await tx.$queryRaw`SELECT "id" FROM "PrivateVideoJob" WHERE "id" = ${initialLink.jobId} FOR SHARE`;
    await tx.$queryRaw`SELECT "id" FROM "PrivateVideoProcessingProof" WHERE "id" = ${initialLink.processingProofId} FOR SHARE`;
    await tx.$queryRaw`SELECT "id" FROM "PrivateVideoEvidenceLink" WHERE "id" = ${initialLink.id} FOR SHARE`;
    await tx.$queryRaw`SELECT "id" FROM "InspectionEvidence" WHERE "id" = ${input.evidenceId} FOR SHARE`;
    await tx.$queryRaw`SELECT "id" FROM "PrivateVideoArtifact" WHERE "jobId" = ${initialLink.jobId} FOR SHARE`;
    const link = await tx.privateVideoEvidenceLink.findUniqueOrThrow({ where: { id: initialLink.id }, include: { evidence: true, processingProof: true, job: { include: { artifacts: true } } } });
    const { job, evidence, processingProof: proof } = link;
    if (link.status !== "STAGED" || link.evidenceId !== input.evidenceId || link.jobId !== initialLink.jobId || link.processingProofId !== initialLink.processingProofId || proof.jobId !== job.id || link.linkedById !== job.actorId || evidence.uploadedById !== job.actorId || evidence.packageId !== parcel.id || job.packageId !== parcel.id || job.status !== "STORED" || job.leaseToken || job.leaseExpiresAt || job.storageNamespace !== store.namespace || evidence.mediaKind !== "VIDEO" || evidence.ciphertext || evidence.iv || evidence.authTag) throw deny();
    const manifest = videoManifestSchema.parse(proof.manifest);
    if (videoManifestHash(manifest) !== proof.manifestSha256) throw deny();
    matchVideoManifest(manifest, job.profile, job.artifacts);
    const refs = ["original", "video", "poster"].map(role => {
      const artifact = job.artifacts.find(row => row.role === role);
      if (!artifact || artifact.status !== "STORED" || artifact.encryptedBody) throw deny();
      const reference = parsePrivateVideoArtifactReference(artifact.storedReference);
      const { versionId, ...metadata } = reference;
      if (!versionId || reference.role !== role || !isDeepStrictEqual(metadata, artifact.preparedReference)) throw deny();
      return reference;
    });
    if (evidence.mimeType !== "video/mp4" || evidence.sha256 !== refs[1].plaintextSha256 || evidence.sizeBytes !== refs[1].sizeBytes) throw deny();
    const finalNow = await current();
    if (proof.verifiedAt < job.createdAt || proof.verifiedAt > finalNow || admin && session.mfaVerifiedAt && finalNow.getTime() - session.mfaVerifiedAt.getTime() > 15 * 60000) throw deny();
    return { actorId: initial.userId, packageId: parcel.id, orderId: parcel.orderId, customerId: order.customerId, linkId: link.id, proofId: proof.id, manifestSha256: proof.manifestSha256, refs, selected: refs[input.artifact === "video" ? 1 : 2] };
  }
  return { async read(raw: Request) {
    let input: Input | undefined, failureLogged = false;
    try {
      if (raw.method && !["GET", "HEAD"].includes(raw.method)) throw new PrivateVideoPreviewError("PRIVATE_VIDEO_METHOD_NOT_ALLOWED");
      if (!["video", "poster"].includes(raw.artifact)) throw deny();
      input = schema.parse(raw);
      const before = await db.$transaction(tx => authorize(tx, input!));
      const returned = await store.read(before.selected);
      if (!Buffer.isBuffer(returned) || returned.length !== before.selected.sizeBytes) throw new PrivateVideoPreviewError();
      const bytes = Buffer.from(returned);
      if (createHash("sha256").update(bytes).digest("hex") !== before.selected.plaintextSha256) throw new PrivateVideoPreviewError();
      let slice: ReturnType<typeof privateVideoByteRange> | undefined;
      try { slice = privateVideoByteRange(bytes.length, input.range, input.ifRange, input.method); } catch { /* Authorize and audit before exposing a 416 total. */ }
      await db.$transaction(async tx => {
        const after = await authorize(tx, input!);
        if (!isDeepStrictEqual(before, after)) throw deny();
        await tx.auditLog.create({ data: { actorId: after.actorId, action: !slice ? "private_video.preview_range_rejected" : input!.method === "HEAD" ? "private_video.preview_head" : "private_video.previewed", entityType: "InspectionEvidence", entityId: input!.evidenceId, metadata: { artifact: input!.artifact, method: input!.method, ...(slice ? { partial: slice.partial, start: slice.start, end: slice.end } : {}) } } });
      });
      if (!slice) { failureLogged = true; throw new PrivateVideoPreviewError("PRIVATE_VIDEO_RANGE_INVALID", bytes.length); }
      return { bytes: input.method === "HEAD" ? null : Buffer.from(bytes.subarray(slice.start, slice.end + 1)), totalBytes: bytes.length, start: slice.start, end: slice.end, status: slice.partial ? 206 as const : 200 as const, mimeType: before.selected.mimeType, artifact: input.artifact, method: input.method };
    } catch (error) {
      if (!failureLogged) {
        try {
          const session = input ? await db.authSession.findUnique({ where: { id: input.sessionId }, select: { userId: true } }) : null;
          await db.auditLog.create({ data: { actorId: session?.userId, action: "private_video.preview_blocked", entityType: "PrivateVideoPreview", metadata: { artifact: input?.artifact ?? "invalid", outcome: error instanceof PrivateVideoPreviewError ? error.code : "UNAVAILABLE" } } });
        } catch { throw new PrivateVideoPreviewError(); }
      }
      if (error instanceof PrivateVideoPreviewError) throw error;
      throw new PrivateVideoPreviewError();
    }
  } };
}
