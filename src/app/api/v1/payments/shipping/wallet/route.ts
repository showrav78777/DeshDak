import { Prisma } from "@prisma/client";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { createReference } from "@/lib/reference";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { recordUserEvent } from "@/modules/activity/service";
import { createFxSnapshot, quoteFx } from "@/modules/fx/service";
import { createTransactionalNotification, orderNotification } from "@/modules/notifications/service";
import { InsufficientWalletBalanceError, postWalletTransaction } from "@/modules/wallet/ledger";

const schema = z.object({ orderId: z.string().uuid() });

export async function POST(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.CUSTOMER_PERSONAL)) return apiError("CUSTOMER_ACCESS_REQUIRED", "Customer access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "This financial action must originate from the protected customer application.", 403);
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
  if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 200) return apiError("IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required.", 422);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Choose a valid order.", 422);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const replay = await tx.shippingPayment.findUnique({ where: { idempotencyKey }, include: { order: { select: { customerId: true } } } });
      if (replay) {
        if (replay.order.customerId !== session.userId) return null;
        if (replay.orderId !== parsed.data.orderId || replay.provider !== "WALLET") throw new Error("IDEMPOTENCY_KEY_REUSED");
        return { payment: replay, replay: true };
      }
      const customer = await tx.user.findUnique({ where: { id: session.userId }, select: { accountType: true } });
      if (!customer) return null;
      const order = await tx.order.findFirst({
        where: { id: parsed.data.orderId, customerId: session.userId, status: "SHIPPING_QUOTE_READY", shippingPayment: null, packages: { every: { OR: [{ isOutboundActive: false }, { status: "MEASURED" }] }, some: { isOutboundActive: true } } },
        include: { shippingQuotes: { where: { status: "ACCEPTED", expiresAt: { gt: new Date() } }, orderBy: { version: "desc" }, take: 1 } },
      });
      const quote = order?.shippingQuotes[0];
      if (!order || !quote) return null;
      const fxQuote = await quoteFx(tx, { baseCurrency: "BDT", quoteCurrency: "BDT", amount: quote.totalBdt, customerSegment: customer.accountType });
      const fxSnapshot = await createFxSnapshot(tx, fxQuote, { type: "SHIPPING_PAYMENT", id: quote.id });
      const payment = await tx.shippingPayment.create({ data: { reference: createReference("SHPAY"), idempotencyKey, provider: "WALLET", orderId: order.id, shippingQuoteId: quote.id, fxSnapshotId: fxSnapshot.id, amount: quote.totalBdt, currency: "BDT", status: "SUCCEEDED" } });
      await postWalletTransaction(tx, { userId: session.userId, currency: "BDT", amount: quote.totalBdt, direction: "DEBIT", type: "PAYMENT_DEBIT", idempotencyKey: `wallet-shipping-payment:${idempotencyKey}`, description: `Shipping payment ${payment.reference}`, sourceType: "SHIPPING_PAYMENT", sourceId: payment.id, debitAccountCode: "CUSTOMER_WALLET_LIABILITY", creditAccountCode: "CUSTOMER_PAYMENT_CLEARING" });
      const nextGrandTotal = order.grandTotal.minus(order.shippingTotal).plus(quote.totalBdt);
      const claimed = await tx.order.updateMany({ where: { id: order.id, status: "SHIPPING_QUOTE_READY" }, data: { status: "READY_TO_SHIP", shippingTotal: quote.totalBdt, grandTotal: nextGrandTotal } });
      if (claimed.count !== 1) throw new Error("SHIPPING_PAYMENT_STATE_CHANGED");
      await tx.shippingQuote.update({ where: { id: quote.id }, data: { status: "PAID" } });
      await tx.package.updateMany({ where: { orderId: order.id, isOutboundActive: true, status: "MEASURED" }, data: { status: "READY_TO_SHIP" } });
      const history = await tx.orderStatusHistory.create({ data: { orderId: order.id, fromStatus: "SHIPPING_QUOTE_READY", toStatus: "READY_TO_SHIP", actorId: session.userId, note: `Shipping payment ${payment.reference} completed from wallet.` } });
      const notification = orderNotification({ userId: order.customerId, orderId: order.id, orderNumber: order.orderNumber, status: "READY_TO_SHIP", eventId: history.id });
      if (notification) await createTransactionalNotification(tx, notification);
      await tx.auditLog.create({ data: { actorId: session.userId, action: "wallet.shipping_payment_completed", entityType: "ShippingPayment", entityId: payment.id, metadata: { orderId: order.id, quoteId: quote.id, amount: quote.totalBdt.toString(), currency: "BDT" } } });
      await recordUserEvent(tx, { idempotencyKey: `shipping-payment:${payment.id}`, userId: session.userId, authSessionId: session.sessionId, category: "COMMERCE", eventType: "SHIPPING_PAYMENT_COMPLETED", objectType: "Order", objectId: order.id, path: `/orders/${order.id}`, metadata: { paymentId: payment.id, amount: quote.totalBdt.toString(), currency: "BDT" } });
      return { payment, replay: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (!result) return apiError("SHIPPING_PAYMENT_NOT_AVAILABLE", "This measured shipping quote is not available for payment.", 409);
    return apiSuccess({ shippingPayment: { id: result.payment.id, reference: result.payment.reference, amount: result.payment.amount, currency: result.payment.currency, status: result.payment.status, provider: result.payment.provider }, idempotentReplay: result.replay, nextAction: "WAIT_FOR_SHIPMENT_CREATION" }, { status: result.replay ? 200 : 201, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    if (error instanceof InsufficientWalletBalanceError || (error as Error).message === "INSUFFICIENT_WALLET_BALANCE") return apiError("INSUFFICIENT_WALLET_BALANCE", "Your available wallet balance is not enough for this shipping payment.", 409);
    if ((error as Error).message === "IDEMPOTENCY_KEY_REUSED") return apiError("IDEMPOTENCY_KEY_REUSED", "This shipping payment key was already used for a different order.", 409);
    if ((error as { code?: string }).code === "P2034" || (error as Error).message === "SHIPPING_PAYMENT_STATE_CHANGED") return apiError("PAYMENT_RETRY_REQUIRED", "The order changed while payment was processing. Please retry safely.", 409);
    throw error;
  }
}
