import { privatePhotoRuntime, privatePhotoStorageConfigured } from "@/modules/private-storage/runtime";
import { createPrivatePhotoSubmissions } from "@/modules/private-storage/submissions";
import { privatePhotoSubmissionError } from "@/modules/private-storage/submission-response";
import { authorizePrivateUpload } from "@/modules/private-storage/upload-authorization";
import { MultipartUploadError, readBoundedMultipart } from "@/lib/uploads/bounded-multipart";
import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { consumeSecurityRateLimit, requestIp } from "@/modules/auth/rate-limit";
import { encryptInspectionEvidence, inspectionEvidenceUploadsEnabled } from "@/modules/operations/inspection-evidence";
import { canAccessWarehouse, getInspectorAccess, getWarehouseAccess } from "@/lib/warehouse-access";
import { inspectionUploadCapabilities } from "@/modules/operations/inspection-upload-capabilities";

export async function GET(request: NextRequest, context: RouteContext<"/api/v1/operations/packages/[packageId]/inspection-evidence">) {
  const session = await getRequestSession(request);
  const [inspector, warehouse] = await Promise.all([getInspectorAccess(session), getWarehouseAccess(session)]);
  const access = inspector ?? warehouse;
  if (!session || !access) return apiError("EVIDENCE_ACCESS_REQUIRED", "Assigned inspection or warehouse access is required.", 403);
  const { packageId } = await context.params;
  const pkg = await prisma.package.findUnique({ where: { id: packageId }, select: { warehouseId: true } });
  if (!pkg || !canAccessWarehouse(access, pkg.warehouseId)) return apiError("PACKAGE_NOT_FOUND", "Package was not found.", 404);
  const evidence = await prisma.inspectionEvidence.findMany({ where: { packageId }, select: { id: true, mediaKind: true, createdAt: true, privatePhotoLink: { select: { upload: { select: { status: true, purpose: true, quarantine: { select: { id: true } }, cleanupAttempt: { select: { id: true } } } } } } }, orderBy: { createdAt: "desc" }, take: 50 });
  return apiSuccess({ evidence: evidence.map(({ privatePhotoLink, ...item }) => ({ ...item, availableForInspection: !privatePhotoLink || privatePhotoLink.upload.status === "STORED" && privatePhotoLink.upload.purpose === "inspection" && !privatePhotoLink.upload.quarantine && !privatePhotoLink.upload.cleanupAttempt })), uploads: inspectionUploadCapabilities(process.env, privatePhotoStorageConfigured()) }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function POST(request: NextRequest, context: RouteContext<"/api/v1/operations/packages/[packageId]/inspection-evidence">) {
  const session = await getRequestSession(request);
  const [inspectorAccess, warehouseAccess] = await Promise.all([getInspectorAccess(session), getWarehouseAccess(session)]);
  const access = inspectorAccess ?? warehouseAccess;
  if (!session || !access) return apiError("EVIDENCE_UPLOAD_ACCESS_REQUIRED", "Assigned inspection or warehouse access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "Evidence must be uploaded from the protected operations application.", 403);
  if (!privatePhotoStorageConfigured() && !inspectionEvidenceUploadsEnabled()) return apiError("INSPECTION_EVIDENCE_UPLOAD_UNAVAILABLE", "Secure inspection upload is unavailable until private storage and malware scanning are configured.", 503);
  const { packageId } = await context.params;
  const pkg = await prisma.package.findUnique({ where: { id: packageId }, select: { id: true, packageCode: true, warehouseId: true, isOutboundActive: true, status: true } });
  if (!pkg || !pkg.isOutboundActive || !canAccessWarehouse(access, pkg.warehouseId)) return apiError("PACKAGE_NOT_FOUND", "Package was not found.", 404);
  if (pkg.status === "EXPECTED") return apiError("PACKAGE_NOT_READY_FOR_EVIDENCE", "Receive the physical package before capturing condition evidence.", 409);
  const [accountLimit, ipLimit] = await Promise.all([
    consumeSecurityRateLimit("inspection-evidence:staff", session.userId, 60, 60 * 60_000),
    consumeSecurityRateLimit("inspection-evidence:ip", requestIp(request), 180, 60 * 60_000),
  ]);
  if (!accountLimit.allowed || !ipLimit.allowed) {
    const response = apiError("TOO_MANY_REQUESTS", "Too many evidence uploads. Please wait before trying again.", 429);
    response.headers.set("Retry-After", String(Math.max(accountLimit.retryAfterSeconds, ipLimit.retryAfterSeconds)));
    return response;
  }
  let formData: FormData;
  try { formData = await readBoundedMultipart(request, process.env.PRIVATE_PHOTO_STORAGE_ENABLED === "true" ? 8 * 1024 * 1024 + 128 * 1024 : 31 * 1024 * 1024); }
  catch (error) {
    if (error instanceof MultipartUploadError) return apiError(error.status === 413 ? "EVIDENCE_TOO_LARGE" : "INVALID_UPLOAD_REQUEST", error.message, error.status);
    return apiError("INVALID_UPLOAD_REQUEST", "Upload form could not be read.", 422);
  }
  const media = formData?.get("media");
  if (!(media instanceof File) || formData.getAll("media").length !== 1) return apiError("EVIDENCE_REQUIRED", "Choose one photo or video to upload.", 422);
  if (process.env.PRIVATE_PHOTO_STORAGE_ENABLED === "true") {
    const runtime = privatePhotoRuntime();
    if (!runtime) return apiError("INSPECTION_EVIDENCE_UPLOAD_UNAVAILABLE", "Secure inspection upload is unavailable.", 503);
    if (!media.type.startsWith("image/")) return apiError("INVALID_EVIDENCE", "Upload a JPEG, PNG or WebP photo. Secure video processing is not available yet.", 422);
    const requestKey = request.headers.get("Idempotency-Key");
    if (!requestKey || !/^[a-zA-Z0-9:_-]{16,128}$/.test(requestKey)) return apiError("IDEMPOTENCY_KEY_REQUIRED", "Supply a stable upload request key before submitting.", 422);
    try {
      const result = await createPrivatePhotoSubmissions(prisma, runtime).submit({ kind: "inspection", actorId: session.userId, sessionId: session.sessionId, requestKey, file: media, packageId });
      const evidence = await prisma.inspectionEvidence.findUniqueOrThrow({ where: { id: result.subjectId }, select: { id: true, mediaKind: true, mimeType: true, sizeBytes: true } });
      return apiSuccess({ evidence: { ...evidence, reference: `inspection-evidence/${evidence.id}` } }, { status: result.replayed ? 200 : 201, headers: { "Cache-Control": "private, no-store, max-age=0" } });
    } catch (error) { return privatePhotoSubmissionError(error); }
  }
  let encrypted;
  try { encrypted = await encryptInspectionEvidence(media); }
  catch (error) { return apiError("INVALID_EVIDENCE", error instanceof Error ? error.message : "Unable to process this evidence.", 422); }
  const evidence = await prisma.$transaction(async (tx) => {
    const current = await authorizePrivateUpload(tx, { userId: session.userId, sessionId: session.sessionId, kind: "inspection", packageId });
    if (!current) return null;
    const created = await tx.inspectionEvidence.create({ data: { packageId, uploadedById: session.userId, ...encrypted } });
    await tx.auditLog.create({ data: { actorId: session.userId, action: "inspection.evidence_uploaded", entityType: "Package", entityId: packageId, metadata: { evidenceId: created.id, mediaKind: created.mediaKind, mimeType: created.mimeType, sizeBytes: created.sizeBytes, packageCode: current.packageCode } } });
    return created;
  });
  if (!evidence) return apiError("EVIDENCE_UPLOAD_ACCESS_REQUIRED", "Your package or assignment access changed during upload. Reload before trying again.", 403);
  return apiSuccess({ evidence: { id: evidence.id, mediaKind: evidence.mediaKind, mimeType: evidence.mimeType, sizeBytes: evidence.sizeBytes, reference: `inspection-evidence/${evidence.id}` } }, { status: 201, headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
