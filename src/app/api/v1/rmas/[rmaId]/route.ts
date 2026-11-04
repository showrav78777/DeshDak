import { type NextRequest } from "next/server";

import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { canAccessWarehouse, getInspectorAccess } from "@/lib/warehouse-access";

export async function GET(request: NextRequest, context: RouteContext<"/api/v1/rmas/[rmaId]">) {
  const session = await getRequestSession(request);
  if (!session) return apiError("AUTHENTICATION_REQUIRED", "Sign in to view this claim.", 401);
  const { rmaId } = await context.params;
  const rma = await prisma.rma.findUnique({ where: { id: rmaId }, include: { customer: { select: { fullName: true, email: true, phone: true } }, order: { select: { orderNumber: true, type: true, currency: true } }, shipment: { select: { trackingNumber: true, status: true, destinationWarehouseId: true } }, items: { include: { package: { select: { packageCode: true } } } }, events: { orderBy: { occurredAt: "asc" }, select: { id: true, fromStatus: true, toStatus: true, note: true, metadata: true, occurredAt: true } }, messages: { orderBy: { createdAt: "asc" }, select: { id: true, senderId: true, body: true, evidenceRefs: true, createdAt: true } }, refunds: { select: { reference: true, amount: true, currency: true, status: true, processedAt: true } } } });
  if (!rma) return apiError("RMA_NOT_FOUND", "Claim was not found.", 404);
  const isAdmin = session.portal === "admin" && session.roles.includes(ROLE.ADMIN);
  const isCustomer = session.portal === "customer" && rma.customerId === session.userId;
  const inspectorAccess = await getInspectorAccess(session);
  const isInspector = Boolean(inspectorAccess && rma.status === "RETURN_RECEIVED" && canAccessWarehouse(inspectorAccess, rma.shipment.destinationWarehouseId));
  if (!isAdmin && !isCustomer && !isInspector) return apiError("RMA_NOT_FOUND", "Claim was not found.", 404);
  const common = { id: rma.id, reference: rma.reference, orderId: rma.orderId, orderNumber: rma.order.orderNumber, orderType: rma.order.type, shipmentId: rma.shipmentId, trackingNumber: rma.shipment.trackingNumber, shipmentStatus: rma.shipment.status, status: rma.status, reason: rma.reason, description: rma.description, evidenceReferences: rma.evidenceRefs, claimDeadlineAtCreation: rma.claimDeadlineAtCreation, createdAfterDeadline: rma.createdAfterDeadline, slaDueAt: rma.slaDueAt, firstResponseAt: rma.firstResponseAt, resolvedAt: rma.resolvedAt, decision: rma.decision, liabilityParty: rma.liabilityParty, approvedRefundAmount: rma.approvedRefundAmount, currency: rma.order.currency, returnRequired: rma.returnRequired, returnInstructions: rma.returnInstructions, returnTrackingNumber: rma.returnTrackingNumber, inspectionResult: rma.inspectionResult, inspectionNotes: rma.inspectionNotes, inspectedAt: rma.inspectedAt, version: rma.version, packageCodes: rma.items.map(({ package: pkg }) => pkg.packageCode), events: rma.events, refunds: rma.refunds, createdAt: rma.createdAt, updatedAt: rma.updatedAt };
  if (isInspector) return apiSuccess({ rma: common }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  return apiSuccess({ rma: { ...common, messages: rma.messages.map((message) => ({ ...message, mine: message.senderId === session.userId })), ...(isAdmin ? { customer: rma.customer, overrideReason: rma.overrideReason, overriddenAt: rma.overriddenAt, adminNotes: rma.adminNotes } : {}) } }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
