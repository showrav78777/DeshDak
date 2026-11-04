import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { createTransactionalNotification, orderNotification } from "@/modules/notifications/service";

const schema = z.object({ action: z.enum(["START_PREPARING", "MARK_READY"]), note: z.string().trim().min(3).max(500) });
const transitions = { START_PREPARING: { from: "APPROVED", to: "SELLER_PREPARING" }, MARK_READY: { from: "SELLER_PREPARING", to: "READY_FOR_COLLECTION" } } as const;

export async function PATCH(request: NextRequest, context: RouteContext<"/api/v1/seller/orders/[sellerOrderId]/status">) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.SELLER)) return apiError("SELLER_ACCESS_REQUIRED", "Seller access is required.", 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Choose a valid preparation action and add a note.", 422);
  const { sellerOrderId } = await context.params;
  const existing = await prisma.sellerOrder.findFirst({ where: { id: sellerOrderId, sellerProfile: { userId: session.userId } }, include: { order: { select: { id: true, customerId: true, orderNumber: true, status: true } } } });
  if (!existing) return apiError("SELLER_ORDER_NOT_FOUND", "Seller order was not found.", 404);
  const transition = transitions[parsed.data.action];
  if (existing.status !== transition.from) return apiError("INVALID_SELLER_ORDER_TRANSITION", "This preparation action cannot follow the current seller-order stage.", 409);

  try {
    const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.sellerOrder.update({ where: { id: sellerOrderId }, data: { status: transition.to, ...(transition.to === "READY_FOR_COLLECTION" ? { readyAt: new Date() } : {}), statusHistory: { create: { fromStatus: transition.from, toStatus: transition.to, actorId: session.userId, note: parsed.data.note } } } });
    let orderAdvanced = false;
    if (transition.to === "READY_FOR_COLLECTION") {
      const notReady = await tx.sellerOrder.count({ where: { orderId: existing.orderId, status: { notIn: ["READY_FOR_COLLECTION", "RECEIVED_AT_ORIGIN_HUB", "COMPLETED"] } } });
      if (notReady === 0 && existing.order.status === "SELLER_PREPARING") {
        const history = await tx.orderStatusHistory.create({ data: { orderId: existing.orderId, fromStatus: existing.order.status, toStatus: "READY_FOR_COLLECTION", actorId: session.userId, note: "All sellers marked their products ready for collection." } });
        await tx.order.update({ where: { id: existing.orderId }, data: { status: "READY_FOR_COLLECTION" } });
        const notification = orderNotification({ userId: existing.order.customerId, orderId: existing.orderId, orderNumber: existing.order.orderNumber, status: "READY_FOR_COLLECTION", eventId: history.id, note: parsed.data.note });
        if (notification) await createTransactionalNotification(tx, notification);
        orderAdvanced = true;
      }
    }
    await tx.auditLog.create({ data: { actorId: session.userId, action: `seller_order.${parsed.data.action.toLowerCase()}`, entityType: "SellerOrder", entityId: sellerOrderId, metadata: { orderId: existing.orderId, fromStatus: transition.from, toStatus: transition.to, note: parsed.data.note } } });
    return { sellerOrder: updated, orderAdvanced };
    }, { isolationLevel: "Serializable" });
    return apiSuccess(result);
  } catch (error) {
    if ((error as { code?: string }).code === "P2034") return apiError("SELLER_ORDER_UPDATE_RETRY_REQUIRED", "Another seller update completed at the same time. Refresh and retry safely.", 409);
    throw error;
  }
}
