import { Prisma, type PaymentIntent } from "@prisma/client";
import { createPlatformCode } from "@/modules/identifiers/service";
import { createTransactionalNotification, orderNotification } from "@/modules/notifications/service";
import { recordUserEvent } from "@/modules/activity/service";

/** Called only after a payment gateway webhook has been verified and recorded. */
export async function createOrderFromPaidPayment(tx: Prisma.TransactionClient, payment: PaymentIntent) {
  if (payment.orderId) {
    const order = await tx.order.findUnique({ where: { id: payment.orderId } });
    if (!order) throw new Error("Payment intent is tied to a missing order.");
    if (order.status === "PENDING_PURCHASE_REVIEW" || order.status === "PENDING_EXPORT_REVIEW") return order;
    if (order.status !== "PENDING_PAYMENT") throw new Error("Order is not awaiting payment.");
    const isSellerOrder = order.type === "LOCAL_SELLER" || order.type === "EXPORT_MARKETPLACE";
    const nextStatus = isSellerOrder ? "PENDING_EXPORT_REVIEW" : "PENDING_PURCHASE_REVIEW";
    const note = isSellerOrder ? "Verified payment received. Awaiting administrator seller-order review." : "Verified payment received. Awaiting administrator purchase review.";
    const updated = await tx.order.update({ where: { id: order.id }, data: { status: nextStatus, statusHistory: { create: { fromStatus: "PENDING_PAYMENT", toStatus: nextStatus, note } } } });
    await tx.inventoryReservation.updateMany({ where: { orderId: order.id, status: "ACTIVE" }, data: { status: "CONSUMED" } });
    if (isSellerOrder) {
      const sellerOrders = await tx.sellerOrder.findMany({ where: { orderId: order.id, status: "PENDING_PAYMENT" }, select: { id: true } });
      for (const sellerOrder of sellerOrders) await tx.sellerOrder.update({ where: { id: sellerOrder.id }, data: { status: "PENDING_ADMIN_REVIEW", statusHistory: { create: { fromStatus: "PENDING_PAYMENT", toStatus: "PENDING_ADMIN_REVIEW", note } } } });
    }
    const notification = orderNotification({ userId: updated.customerId, orderId: updated.id, orderNumber: updated.orderNumber, status: updated.status, eventId: `payment:${payment.id}` });
    if (notification) await createTransactionalNotification(tx, notification);
    await recordUserEvent(tx, { idempotencyKey: `commerce:payment:${payment.id}`, userId: updated.customerId, category: "COMMERCE", eventType: "ORDER_PAYMENT_CONFIRMED", objectType: "Order", objectId: updated.id, metadata: { orderNumber: updated.orderNumber } });
    return updated;
  }
  if (!payment.sourcingQuoteId) throw new Error("Payment intent is not tied to a sourcing quote.");
  const quote = await tx.sourcingQuote.findUnique({ where: { id: payment.sourcingQuoteId }, include: { sourcingRequest: true } });
  if (!quote || quote.status !== "ACCEPTED") throw new Error("Payment quote is not accepted.");
  const existing = await tx.order.findUnique({ where: { sourcingRequestId: quote.sourcingRequestId } });
  if (existing) return existing;
  const created = await tx.order.create({ data: { orderNumber: createPlatformCode("ORDER"), customerId: quote.sourcingRequest.customerId, sourcingRequestId: quote.sourcingRequestId, status: "PENDING_PURCHASE_REVIEW", currency: payment.currency, grandTotal: payment.amount, paymentIntent: { connect: { id: payment.id } }, statusHistory: { create: { toStatus: "PENDING_PURCHASE_REVIEW", note: "Verified payment received. Awaiting admin purchase review." } } } });
  const notification = orderNotification({ userId: created.customerId, orderId: created.id, orderNumber: created.orderNumber, status: created.status, eventId: `payment:${payment.id}` });
  if (notification) await createTransactionalNotification(tx, notification);
  await recordUserEvent(tx, { idempotencyKey: `commerce:payment:${payment.id}`, userId: created.customerId, category: "COMMERCE", eventType: "ORDER_PAYMENT_CONFIRMED", objectType: "Order", objectId: created.id, metadata: { orderNumber: created.orderNumber } });
  return created;
}
