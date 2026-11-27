import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { canAccessWarehouse, getInspectorAccess } from "@/lib/warehouse-access";
import { inspectionEvidencePattern, inspectionFingerprint, inspectionResponseSelect, packageInspectionSchema } from "@/modules/warehouse/inspection-policy";

const privateHeaders = { "Cache-Control": "private, no-store, max-age=0" };
export async function POST(request: NextRequest, context: RouteContext<"/api/v1/operations/packages/[packageId]/inspect">) {
  const session = await getRequestSession(request), access = await getInspectorAccess(session);
  if (!session || !access) return apiError("INSPECTION_ACCESS_REQUIRED", "Inspection access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "Use the protected Inspector application.", 403);
  const key = request.headers.get("Idempotency-Key")?.trim();
  if (!key || !/^[A-Za-z0-9:._-]{16,255}$/.test(key)) return apiError("IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required.", 422);
  const parsed = packageInspectionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Check the inspection details.", 422);
  const { packageId } = await context.params;
  const pkg = await prisma.package.findUnique({ where: { id: packageId }, select: { id: true, warehouseId: true, isOutboundActive: true } });
  if (!pkg || !pkg.isOutboundActive || !canAccessWarehouse(access, pkg.warehouseId)) return apiError("PACKAGE_NOT_FOUND", "Package was not found.", 404);
  const fingerprint = inspectionFingerprint(session.userId, packageId, parsed.data);
  async function replayResult() {
    const previous = await prisma.inspection.findUnique({ where: { idempotencyKey: key }, select: { requestFingerprint: true, ...inspectionResponseSelect } });
    if (!previous) return null;
    if (previous.requestFingerprint !== fingerprint || previous.inspectorId !== session!.userId || previous.packageId !== packageId) return apiError("IDEMPOTENCY_KEY_CONFLICT", "This request key belongs to a different inspection. Refresh and review the recorded decision.", 409);
    const { requestFingerprint: _fingerprint, ...inspection } = previous;
    void _fingerprint;
    return apiSuccess({ inspection, idempotentReplay: true }, { headers: privateHeaders });
  }
  const replay = await replayResult();
  if (replay) return replay;
  try {
    const inspection = await prisma.$transaction(async tx => {
      const current = await tx.package.findUnique({ where: { id: packageId }, select: { status: true, isOutboundActive: true, warehouseId: true, packageCode: true, orderId: true, order: { select: { status: true } } } });
      if (!current || !current.isOutboundActive || !canAccessWarehouse(access, current.warehouseId) || current.status !== "RECEIVED" || !["WAREHOUSE_RECEIVED", "INSPECTION"].includes(current.order.status)) throw new Error("INSPECTION_CONFLICT");
      const orderLock = await tx.order.updateMany({ where: { id: current.orderId, status: current.order.status }, data: { updatedAt: new Date() } });
      if (orderLock.count !== 1) throw new Error("INSPECTION_CONFLICT");
      if (await tx.package.count({ where: { orderId: current.orderId, isOutboundActive: true, status: "EXPECTED" } })) throw new Error("INSPECTION_CONFLICT");
      if (parsed.data.mediaReference) {
        if (!inspectionEvidencePattern.test(parsed.data.mediaReference)) throw new Error("INVALID_EVIDENCE");
        const evidenceId = parsed.data.mediaReference.split("/")[1];
        await tx.$queryRaw`SELECT "id" FROM "InspectionEvidence" WHERE "id"=${evidenceId} AND "packageId"=${packageId} FOR SHARE`;
        const evidence = await tx.inspectionEvidence.findFirst({ where: { id: evidenceId, packageId }, select: { mediaKind: true, privateVideoLink: { select: { id: true } }, privatePhotoLink: { select: { uploadId: true } } } });
        if (!evidence || (parsed.data.type !== "BASIC" && evidence.mediaKind !== parsed.data.type)) throw new Error("INVALID_EVIDENCE");
        if (evidence.privateVideoLink) throw new Error("EVIDENCE_UNDER_REVIEW");
        if (evidence.privatePhotoLink) {
          await tx.$queryRaw`SELECT "id" FROM "PrivatePhotoUpload" WHERE "id"=${evidence.privatePhotoLink.uploadId} FOR SHARE`;
          const upload = await tx.privatePhotoUpload.findUnique({ where: { id: evidence.privatePhotoLink.uploadId }, select: { status: true, purpose: true, quarantine: { select: { id: true } }, cleanupAttempt: { select: { id: true } } } });
          if (!upload || upload.status !== "STORED" || upload.purpose !== "inspection" || upload.quarantine || upload.cleanupAttempt) throw new Error("EVIDENCE_UNDER_REVIEW");
        }
      }
      const packageLock = await tx.package.updateMany({ where: { id: packageId, status: "RECEIVED", isOutboundActive: true, warehouseId: current.warehouseId }, data: { status: "INSPECTED", qcStatus: parsed.data.result } });
      if (packageLock.count !== 1) throw new Error("INSPECTION_CONFLICT");
      const created = await tx.inspection.create({ data: { packageId, inspectorId: session.userId, idempotencyKey: key, requestFingerprint: fingerprint, type: parsed.data.type, result: parsed.data.result, notes: parsed.data.notes || null, mediaRefs: parsed.data.mediaReference ? [parsed.data.mediaReference] : undefined }, select: inspectionResponseSelect });
      await tx.packageEvent.create({ data: { packageId, eventType: "INSPECTED", status: "INSPECTED", actorId: session.userId, note: parsed.data.notes || `Package ${parsed.data.result.toLowerCase().replaceAll("_", " ")}.`, metadata: { type: parsed.data.type, result: parsed.data.result, evidenceCount: parsed.data.mediaReference ? 1 : 0 } } });
      const nextOrderStatus = parsed.data.result === "PASSED" ? "INSPECTION" : "ON_HOLD";
      await tx.order.update({ where: { id: current.orderId }, data: { status: nextOrderStatus, statusHistory: { create: { fromStatus: current.order.status, toStatus: nextOrderStatus, actorId: session.userId, note: parsed.data.result === "PASSED" ? `Package ${current.packageCode} passed ${parsed.data.type.toLowerCase()} inspection.` : `Package ${current.packageCode} requires attention after ${parsed.data.type.toLowerCase()} inspection: ${parsed.data.notes || parsed.data.result}.` } } } });
      await tx.auditLog.create({ data: { actorId: session.userId, action: "inspection.package_completed", entityType: "Package", entityId: packageId, metadata: { type: parsed.data.type, result: parsed.data.result, evidenceCount: parsed.data.mediaReference ? 1 : 0 } } });
      return created;
    }, { isolationLevel: "Serializable" });
    return apiSuccess({ inspection, idempotentReplay: false }, { status: 201, headers: privateHeaders });
  } catch (error) {
    if ((error as Error).message === "EVIDENCE_UNDER_REVIEW") {
      await prisma.auditLog.create({ data: { actorId: session.userId, action: "inspection.evidence_attachment_blocked", entityType: "Package", entityId: packageId, metadata: { outcome: "EVIDENCE_UNDER_REVIEW" } } });
      return apiError("EVIDENCE_UNDER_REVIEW", "This evidence is unavailable or under safety review. Choose other approved evidence for this package.", 409);
    }
    if ((error as Error).message === "INVALID_EVIDENCE") return apiError("INVALID_EVIDENCE", "Choose matching evidence captured for this package.", 422);
    if ((error as Error).message === "INSPECTION_CONFLICT" || ["P2002", "P2034"].includes((error as { code?: string }).code ?? "")) return await replayResult() ?? apiError("PACKAGE_NOT_READY_FOR_INSPECTION", "The package or order changed. Every parcel must arrive before inspection; refresh and review any existing decision.", 409);
    throw error;
  }
}
