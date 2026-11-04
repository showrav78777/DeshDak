import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { createReference } from "@/lib/reference";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { canTransitionOrder } from "@/modules/orders/state-machine";
import { createTransactionalNotification } from "@/modules/notifications/service";
import { querySslCommerzRefund, SslCommerzError, type SslCommerzConfig } from "@/modules/payments/sslcommerz";

function config(): SslCommerzConfig | null { const environment = process.env.SSLCOMMERZ_ENVIRONMENT?.trim().toLowerCase(); const storeId = process.env.SSLCOMMERZ_STORE_ID?.trim(); const storePassword = process.env.SSLCOMMERZ_STORE_PASSWORD?.trim(); return (environment === "sandbox" || environment === "live") && storeId && storePassword ? { environment, storeId, storePassword, appBaseUrl: process.env.APP_BASE_URL ?? "http://localhost:3000" } : null; }

export async function POST(request: NextRequest, context: { params: Promise<{ refundId: string }> }) {
  const session = await getRequestSession(request);
  if (!session || session.portal !== "finance" || !session.roles.includes(ROLE.FINANCE)) return apiError("FINANCE_ACCESS_REQUIRED", "MFA-verified Finance access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "Refund synchronization must originate from the protected Finance application.", 403);
  const configured = config(); if (!configured) return apiError("PAYMENT_GATEWAY_UNAVAILABLE", "SSLCommerz refund credentials are not configured on the server.", 503);
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim(); if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 200) return apiError("IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required.", 400);
  const { refundId } = await context.params;
  const refund = await prisma.refund.findFirst({ where: { id: refundId, destination: "ORIGINAL_METHOD", status: { in: ["PROCESSING", "SUCCEEDED"] }, providerRefundReference: { not: null }, paymentIntent: { provider: "SSLCOMMERZ" } }, include: { order: true, rma: true, paymentIntent: true } });
  if (!refund?.providerRefundReference) return apiError("REFUND_NOT_SYNCHRONIZABLE", "This refund has no accepted provider reference to synchronize.", 409);
  const requestFingerprint = createHash("sha256").update(JSON.stringify({ refundId, providerRefundReference: refund.providerRefundReference })).digest("hex");
  const operationKey = `refund-status:${idempotencyKey}`;
  const replay = await prisma.refundGatewayOperation.findUnique({ where: { idempotencyKey: operationKey } });
  if (replay) { const current = await prisma.refund.findUniqueOrThrow({ where: { id: refundId } }); return apiSuccess({ refund: { id: current.id, reference: current.reference, status: current.status, providerStatus: current.providerStatus, processedAt: current.processedAt }, idempotentReplay: true }); }
  let result;
  try { result = await querySslCommerzRefund({ providerRefundReference: refund.providerRefundReference }, configured); }
  catch (error) { if (error instanceof SslCommerzError) return apiError("REFUND_STATUS_UNAVAILABLE", "The provider status could not be verified. No local financial state changed.", 502); throw error; }
  const updated = await prisma.$transaction(async (tx) => {
    await tx.refundGatewayOperation.create({ data: { refundId, operation: "STATUS_QUERY", provider: "SSLCOMMERZ", outcome: result.outcome, providerStatus: result.providerStatus, providerRefundReference: result.providerRefundReference, providerTransactionId: result.providerTransactionId, bankTransactionId: result.bankTransactionId, responseEvidence: { initiatedOn: result.initiatedOn, refundedOn: result.refundedOn }, idempotencyKey: operationKey, requestFingerprint, actorId: session.userId } });
    const current = await tx.refund.findUniqueOrThrow({ where: { id: refundId } });
    const nextStatus = result.outcome === "SUCCEEDED" ? "SUCCEEDED" : result.outcome === "FAILED" ? "FAILED" : "PROCESSING";
    const changed = await tx.refund.update({ where: { id: refundId }, data: { status: nextStatus, providerStatus: result.providerStatus, providerStatusCheckedAt: new Date(), processedAt: nextStatus === "SUCCEEDED" ? (current.processedAt ?? new Date()) : current.processedAt } });
    if (result.outcome === "SUCCEEDED" && current.status !== "SUCCEEDED") {
      const journalExists = await tx.financialJournal.findUnique({ where: { eventType_eventId: { eventType: "ORIGINAL_METHOD_REFUND", eventId: refundId } } });
      if (!journalExists) await tx.financialJournal.create({ data: { reference: createReference("JRN"), eventType: "ORIGINAL_METHOD_REFUND", eventId: refundId, currency: refund.currency, description: `Original-method refund ${refund.reference}`, entries: { create: [{ accountCode: "CUSTOMER_REFUND_CLEARING", direction: "DEBIT", amount: refund.amount, currency: refund.currency, memo: refund.reference }, { accountCode: "PAYMENT_GATEWAY_CLEARING", direction: "CREDIT", amount: refund.amount, currency: refund.currency, memo: refund.reference }] } } });
      if (refund.rma && refund.rma.status === "INSPECTED") { await tx.rma.update({ where: { id: refund.rma.id }, data: { status: "REFUNDED", resolvedAt: new Date(), version: { increment: 1 } } }); await tx.rmaEvent.create({ data: { rmaId: refund.rma.id, fromStatus: "INSPECTED", toStatus: "REFUNDED", actorId: session.userId, note: `Original-method refund confirmed as ${refund.reference}.`, metadata: { refundId, provider: "SSLCOMMERZ", providerRefundReference: result.providerRefundReference } } }); }
      const otherSucceeded = await tx.refund.aggregate({ where: { orderId: refund.orderId, status: "SUCCEEDED", id: { not: refundId } }, _sum: { amount: true } });
      if ((otherSucceeded._sum.amount ?? new Prisma.Decimal(0)).plus(refund.amount).gte(refund.paymentIntent.amount) && canTransitionOrder(refund.order.status, "REFUNDED")) { await tx.order.update({ where: { id: refund.orderId }, data: { status: "REFUNDED" } }); await tx.orderStatusHistory.create({ data: { orderId: refund.orderId, fromStatus: refund.order.status, toStatus: "REFUNDED", actorId: session.userId, note: `Full original-method refund confirmed as ${refund.reference}.` } }); }
      await createTransactionalNotification(tx, { userId: refund.order.customerId, eventType: "REFUND_ORIGINAL_METHOD_SUCCEEDED", title: `Refund completed for ${refund.order.orderNumber}`, body: `${refund.currency} ${refund.amount.toFixed(2)} was returned through the original payment method. Bank posting time may vary.`, deepLink: `/orders/${refund.orderId}`, entityType: "Refund", entityId: refundId, priority: "HIGH", idempotencyKey: `refund-original-method-completed:${refundId}` });
    }
    await tx.auditLog.create({ data: { actorId: session.userId, action: "refund.original_method_status_synchronized", entityType: "Refund", entityId: refundId, metadata: { provider: "SSLCOMMERZ", previousStatus: current.status, nextStatus, providerStatus: result.providerStatus } } });
    return changed;
  }, { isolationLevel: "Serializable" });
  return apiSuccess({ refund: { id: updated.id, reference: updated.reference, status: updated.status, providerStatus: updated.providerStatus, processedAt: updated.processedAt }, idempotentReplay: false }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
