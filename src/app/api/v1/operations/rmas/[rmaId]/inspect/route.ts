import { type NextRequest } from "next/server";

import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { canAccessWarehouse, getInspectorAccess } from "@/lib/warehouse-access";
import { createTransactionalNotification } from "@/modules/notifications/service";
import { canTransitionRma } from "@/modules/rma/policy";
import { inspectRmaSchema } from "@/modules/rma/schemas";

export async function POST(request: NextRequest, context: RouteContext<"/api/v1/operations/rmas/[rmaId]/inspect">) {
  const session = await getRequestSession(request); const access = await getInspectorAccess(session);
  if (!session || !access) return apiError("INSPECTION_ACCESS_REQUIRED", "Inspector access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "This inspection must originate from the protected Inspector application.", 403);
  const parsed = inspectRmaSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Check the return inspection.", 422);
  const { rmaId } = await context.params;
  const current = await prisma.rma.findUnique({ where: { id: rmaId }, include: { shipment: { select: { destinationWarehouseId: true } } } });
  if (!current || !canAccessWarehouse(access, current.shipment.destinationWarehouseId)) return apiError("RMA_NOT_FOUND", "Return inspection task was not found in an assigned warehouse.", 404);
  if (current.version !== parsed.data.version) return apiError("RMA_STATE_CHANGED", "This return changed after the page loaded. Refresh before inspecting.", 409);
  if (!current.returnRequired || !canTransitionRma(current.status, "INSPECTED")) return apiError("RETURN_NOT_READY_FOR_INSPECTION", "The physical return must be received before inspection.", 409);
  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const changed = await tx.rma.updateMany({ where: { id: current.id, status: current.status, version: current.version }, data: { status: "INSPECTED", inspectionResult: parsed.data.result, inspectionNotes: parsed.data.notes, inspectedById: session.userId, inspectedAt: now, version: { increment: 1 } } });
    if (changed.count !== 1) return null;
    await tx.rmaEvent.create({ data: { rmaId: current.id, fromStatus: current.status, toStatus: "INSPECTED", actorId: session.userId, note: parsed.data.notes, metadata: { result: parsed.data.result, evidenceReferences: parsed.data.evidenceReferences, evidenceCount: parsed.data.evidenceReferences.length } } });
    await tx.auditLog.create({ data: { actorId: session.userId, action: "rma.return_inspected", entityType: "Rma", entityId: current.id, metadata: { result: parsed.data.result, evidenceCount: parsed.data.evidenceReferences.length, warehouseId: current.shipment.destinationWarehouseId } } });
    await createTransactionalNotification(tx, { userId: current.customerId, eventType: "RMA_INSPECTED", title: `Return inspection completed for ${current.reference}`, body: "The physical return inspection is complete and the administrator will record the final decision.", deepLink: `/rmas/${current.id}`, entityType: "Rma", entityId: current.id, priority: "HIGH", idempotencyKey: `rma-notification:inspection:${current.id}:${current.version}` });
    return tx.rma.findUniqueOrThrow({ where: { id: current.id }, select: { id: true, reference: true, status: true, inspectionResult: true, inspectedAt: true, version: true } });
  });
  if (!updated) return apiError("RMA_STATE_CHANGED", "The return changed while the inspection was saved. Refresh before retrying.", 409);
  return apiSuccess({ rma: updated }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
