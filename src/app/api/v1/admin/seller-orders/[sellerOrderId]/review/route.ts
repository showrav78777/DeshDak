import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { createTransactionalNotification, orderNotification } from "@/modules/notifications/service";

const schema = z.object({ action: z.enum(["APPROVE", "HOLD"]), note: z.string().trim().min(3).max(500) });

export async function PATCH(request: NextRequest, context: RouteContext<"/api/v1/admin/seller-orders/[sellerOrderId]/review">) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN)) return apiError("ADMIN_ACCESS_REQUIRED", "Admin access is required.", 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Choose a review action and add a note.", 422);
  const { sellerOrderId } = await context.params;
  const existing = await prisma.sellerOrder.findUnique({ where: { id: sellerOrderId }, include: { order: { select: { id: true, customerId: true, orderNumber: true, status: true } }, sellerProfile: { select: { businessName: true } } } });
  if (!existing) return apiError("SELLER_ORDER_NOT_FOUND", "Seller order was not found.", 404);
  if (existing.status !== "PENDING_ADMIN_REVIEW" || existing.order.status !== "PENDING_EXPORT_REVIEW") return apiError("SELLER_ORDER_NOT_REVIEWABLE", "This seller order is no longer waiting for review.", 409);

  try {
    const result = await prisma.$transaction(async (tx) => {
    const nextStatus = parsed.data.action === "APPROVE" ? "APPROVED" : "ON_HOLD";
    const updated = await tx.sellerOrder.update({ where: { id: sellerOrderId }, data: { status: nextStatus, reviewedAt: new Date(), ...(nextStatus === "APPROVED" ? { approvedAt: new Date() } : {}), statusHistory: { create: { fromStatus: existing.status, toStatus: nextStatus, actorId: session.userId, note: parsed.data.note } } } });
    let orderStatus = existing.order.status;
    if (nextStatus === "ON_HOLD") orderStatus = "ON_HOLD";
    else {
      const remaining = await tx.sellerOrder.count({ where: { orderId: existing.orderId, status: "PENDING_ADMIN_REVIEW" } });
      if (remaining === 0) orderStatus = "SELLER_PREPARING";
    }
    if (orderStatus !== existing.order.status) {
      const history = await tx.orderStatusHistory.create({ data: { orderId: existing.orderId, fromStatus: existing.order.status, toStatus: orderStatus, actorId: session.userId, note: orderStatus === "SELLER_PREPARING" ? "All seller sub-orders passed administrator review and were released for preparation." : parsed.data.note } });
      await tx.order.update({ where: { id: existing.orderId }, data: { status: orderStatus } });
      const notification = orderNotification({ userId: existing.order.customerId, orderId: existing.orderId, orderNumber: existing.order.orderNumber, status: orderStatus, eventId: history.id, note: parsed.data.note });
      if (notification) await createTransactionalNotification(tx, notification);
    }
    await tx.auditLog.create({ data: { actorId: session.userId, action: `seller_order.${parsed.data.action.toLowerCase()}`, entityType: "SellerOrder", entityId: sellerOrderId, metadata: { orderId: existing.orderId, seller: existing.sellerProfile.businessName, note: parsed.data.note } } });
    return { sellerOrder: updated, orderStatus };
    }, { isolationLevel: "Serializable" });
    return apiSuccess(result);
  } catch (error) {
    if ((error as { code?: string }).code === "P2034") return apiError("SELLER_ORDER_REVIEW_RETRY_REQUIRED", "Another seller-order review completed at the same time. Refresh and retry safely.", 409);
    throw error;
  }
}
