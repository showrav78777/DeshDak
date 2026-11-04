import { type NextRequest } from "next/server";
import { OrderStatus } from "@prisma/client";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { canTransitionOrder } from "@/modules/orders/state-machine";
import { createTransactionalNotification, orderNotification } from "@/modules/notifications/service";

const schema = z.object({ status: z.nativeEnum(OrderStatus), note: z.string().trim().min(3).max(500) });
const purchaseGateStatuses: OrderStatus[] = ["DRAFT", "PENDING_PAYMENT", "PAID", "PENDING_PURCHASE_REVIEW", "PENDING_EXPORT_REVIEW", "SOURCING"];
const workflowManagedStatuses: OrderStatus[] = ["SHIPPING_QUOTE_PENDING_CUSTOMER_APPROVAL", "SHIPPING_QUOTE_READY", "SHIPPING_PAYMENT_PENDING"];

export async function PATCH(request: NextRequest, context: RouteContext<"/api/v1/admin/orders/[orderId]/status">) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN)) return apiError("ADMIN_ACCESS_REQUIRED", "Admin access is required.", 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Choose a valid next stage and add an update note.", 422, z.treeifyError(parsed.error));
  const { orderId } = await context.params;
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true, customerId: true, orderNumber: true, type: true, status: true, destinationCountryCode: true, statusHistory: { where: { toStatus: "ON_HOLD" }, orderBy: { createdAt: "desc" }, take: 1, select: { fromStatus: true } } } });
  if (!order) return apiError("ORDER_NOT_FOUND", "Order was not found.", 404);
  // A double click or a delayed browser refresh must not make a correctly
  // completed transition look like a failed one to an operations employee.
  if (order.status === parsed.data.status) return apiSuccess({ order, alreadyAtRequestedStage: true });
  if (order.type === "BUY_AND_SHIP" && order.status === "PURCHASED" && parsed.data.status === "SUPPLIER_SHIPPED" && await prisma.supplierOrderRecord.count({ where: { orderId, correction: null } })) return apiError("DISPATCH_RECORDS_REQUIRED", "Record dispatch for every active supplier record from Purchases → Supplier references & items.", 409);
  if (order.type === "BUY_AND_SHIP" && order.status !== "ON_HOLD" && parsed.data.status === "WAREHOUSE_RECEIVED" && await prisma.supplierInboundDispatch.count({ where: { supplierRecord: { orderId } } })) return apiError("WAREHOUSE_RECEIPT_REQUIRED", "The assigned warehouse must physically receive all expected parcels.", 409);
  if (purchaseGateStatuses.includes(order.status)) return apiError("PURCHASE_REVIEW_REQUIRED", "Use Purchase Review for this order before operational updates.", 409);
  if ((order.type === "LOCAL_SELLER" || order.type === "EXPORT_MARKETPLACE") && order.status === "SELLER_PREPARING" && parsed.data.status === "READY_FOR_COLLECTION") return apiError("SELLER_WORKFLOW_REQUIRED", "Each seller must mark their sub-order ready in the seller workflow.", 409);
  if (parsed.data.status === "BD_WAREHOUSE" && order.destinationCountryCode && order.destinationCountryCode !== "BD") return apiError("DESTINATION_STAGE_MISMATCH", "Use the generic destination-hub stage for a non-Bangladesh delivery.", 409);
  if (parsed.data.status === "DESTINATION_WAREHOUSE" && (!order.destinationCountryCode || order.destinationCountryCode === "BD")) return apiError("DESTINATION_STAGE_MISMATCH", "Use the Bangladesh warehouse stage for a Bangladesh delivery.", 409);
  if (workflowManagedStatuses.includes(parsed.data.status)) return apiError("DEDICATED_WORKFLOW_REQUIRED", "Use the final shipping quote or payment workflow for this stage.", 409);
  if ((order.status === "SHIPPING_QUOTE_READY" || order.status === "SHIPPING_PAYMENT_PENDING") && parsed.data.status === "READY_TO_SHIP") return apiError("SHIPPING_PAYMENT_REQUIRED", "Complete the separate shipping payment workflow before marking this order ready to ship.", 409);
  if (order.status === "ON_HOLD") {
    const resumeStatus = order.statusHistory[0]?.fromStatus;
    if (resumeStatus && workflowManagedStatuses.includes(resumeStatus)) return apiError("NEW_SHIPPING_QUOTE_REQUIRED", "Issue a new measured shipping quote instead of manually resuming this stage.", 409);
    const permitted = parsed.data.status === resumeStatus || parsed.data.status === "CANCELLED" || parsed.data.status === "REFUNDED";
    if (!permitted || (resumeStatus && purchaseGateStatuses.includes(resumeStatus))) return apiError("PURCHASE_REVIEW_REQUIRED", "This held order must return to Purchase Review.", 409);
  } else if (!canTransitionOrder(order.status, parsed.data.status)) return apiError("INVALID_ORDER_TRANSITION", `This order is currently at ${order.status.replaceAll("_", " ")}. Refresh it and choose the next available stage.`, 409, { currentStatus: order.status, requestedStatus: parsed.data.status });
  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.order.update({ where: { id: orderId }, data: { status: parsed.data.status } });
    const history = await tx.orderStatusHistory.create({ data: { orderId, fromStatus: order.status, toStatus: parsed.data.status, actorId: session.userId, note: parsed.data.note } });
    const sellerStatus = parsed.data.status === "SELLER_PREPARING" ? "SELLER_PREPARING" : parsed.data.status === "READY_FOR_COLLECTION" ? "READY_FOR_COLLECTION" : parsed.data.status === "WAREHOUSE_RECEIVED" ? "RECEIVED_AT_ORIGIN_HUB" : null;
    if ((order.type === "LOCAL_SELLER" || order.type === "EXPORT_MARKETPLACE") && sellerStatus) {
      const sellerOrders = await tx.sellerOrder.findMany({ where: { orderId, status: { notIn: ["CANCELLED", "COMPLETED"] } }, select: { id: true, status: true } });
      for (const sellerOrder of sellerOrders) await tx.sellerOrder.update({ where: { id: sellerOrder.id }, data: { status: sellerStatus, ...(sellerStatus === "SELLER_PREPARING" ? { approvedAt: new Date(), reviewedAt: new Date() } : {}), ...(sellerStatus === "READY_FOR_COLLECTION" ? { readyAt: new Date() } : {}), statusHistory: { create: { fromStatus: sellerOrder.status, toStatus: sellerStatus, actorId: session.userId, note: parsed.data.note } } } });
    }
    const notification = orderNotification({ userId: order.customerId, orderId, orderNumber: order.orderNumber, status: parsed.data.status, eventId: history.id, note: parsed.data.note });
    if (notification) await createTransactionalNotification(tx, notification);
    await tx.auditLog.create({ data: { actorId: session.userId, action: "order.status_updated", entityType: "Order", entityId: orderId, metadata: { orderNumber: order.orderNumber, fromStatus: order.status, toStatus: parsed.data.status, note: parsed.data.note } } });
    return saved;
  });
  return apiSuccess({ order: updated });
}
