import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { createReference } from "../../lib/reference.ts";
import { calculateRefund } from "./calculation.ts";

export class OriginalMethodRefundError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

export function sslCommerzBankTransactionId(payload: Prisma.JsonValue | null) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const evidence = "evidence" in payload && payload.evidence && typeof payload.evidence === "object" && !Array.isArray(payload.evidence) ? payload.evidence : null;
  const value = evidence && "bankTransactionId" in evidence ? evidence.bankTransactionId : null;
  return typeof value === "string" && value.trim().length >= 3 && value.trim().length <= 80 ? value.trim() : null;
}

export function originalRefundFingerprint(input: { orderId: string; rmaId: string; reason: string }) {
  return createHash("sha256").update(JSON.stringify({ orderId: input.orderId, rmaId: input.rmaId, reason: input.reason, destination: "ORIGINAL_METHOD" })).digest("hex");
}

export async function reserveOriginalMethodRefund(tx: Prisma.TransactionClient, input: { orderId: string; rmaId: string; reason: string; actorId: string; idempotencyKey: string; requestFingerprint: string }) {
  const existing = await tx.refund.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { paymentIntent: true } });
  if (existing) {
    if (existing.requestFingerprint !== input.requestFingerprint || existing.destination !== "ORIGINAL_METHOD") throw new OriginalMethodRefundError("IDEMPOTENCY_KEY_REUSED", "This request key belongs to different refund details.");
    const bankTransactionId = sslCommerzBankTransactionId(existing.paymentIntent.gatewayPayload);
    if (!bankTransactionId) throw new OriginalMethodRefundError("VERIFIED_BANK_TRANSACTION_REQUIRED", "Verified bank transaction evidence is unavailable.");
    return { refund: existing, bankTransactionId, replay: true };
  }
  const order = await tx.order.findUnique({
    where: { id: input.orderId },
    include: {
      customer: { select: { accountType: true } },
      paymentIntent: { include: { fxSnapshot: true, settlementEntries: { where: { matchStatus: "MATCHED" }, select: { id: true }, take: 1 } } },
      refunds: { where: { status: { in: ["PENDING_APPROVAL", "APPROVED", "PROCESSING", "SUCCEEDED"] } }, select: { amount: true, requestedBaseAmount: true, promotionNettingBaseAmount: true, netBaseAmount: true } },
    },
  });
  if (!order?.paymentIntent || order.paymentIntent.status !== "SUCCEEDED" || order.paymentIntent.provider !== "SSLCOMMERZ") throw new OriginalMethodRefundError("ORDER_NOT_REFUNDABLE", "Only a verified SSLCommerz payment can use this refund path.");
  if (order.paymentIntent.currency !== "BDT") throw new OriginalMethodRefundError("UNSUPPORTED_REFUND_CURRENCY", "The certified SSLCommerz refund path currently accepts BDT only.");
  if (!order.paymentIntent.settlementEntries.length) throw new OriginalMethodRefundError("PAYMENT_RECONCILIATION_REQUIRED", "The payment must match imported settlement evidence before refund initiation.");
  const bankTransactionId = sslCommerzBankTransactionId(order.paymentIntent.gatewayPayload);
  if (!bankTransactionId) throw new OriginalMethodRefundError("VERIFIED_BANK_TRANSACTION_REQUIRED", "The bank transaction ID must come from verified gateway evidence.");
  const rma = await tx.rma.findUnique({ where: { id: input.rmaId }, include: { refunds: { where: { status: { in: ["PENDING_APPROVAL", "APPROVED", "PROCESSING", "SUCCEEDED"] } }, select: { id: true } } } });
  if (!rma || rma.orderId !== order.id || rma.status !== "INSPECTED" || !["FULL_REFUND", "PARTIAL_REFUND"].includes(rma.decision ?? "") || !rma.approvedRefundAmount || !rma.refundDecisionById || !rma.refundDecisionAt || rma.refunds.length) throw new OriginalMethodRefundError("RMA_REFUND_NOT_APPROVED", "The claim is not independently approved or already has an active refund.");
  if (rma.refundDecisionById === input.actorId) throw new OriginalMethodRefundError("INDEPENDENT_REFUND_APPROVER_REQUIRED", "The claim decision-maker cannot initiate its financial refund.");
  const fxSnapshot = order.paymentIntent.fxSnapshot;
  if (!fxSnapshot?.baseAmount || fxSnapshot.baseCurrency !== order.currency || fxSnapshot.quoteCurrency !== order.paymentIntent.currency) throw new OriginalMethodRefundError("ORIGINAL_FX_SNAPSHOT_REQUIRED", "The original locked FX evidence is unavailable.");
  const paidBaseAmount = fxSnapshot.baseAmount;
  const priorRefunds = order.refunds.map((refund) => {
    const promotion = refund.promotionNettingBaseAmount ?? new Prisma.Decimal(0);
    const net = refund.netBaseAmount ?? refund.amount.mul(paidBaseAmount).div(order.paymentIntent!.amount).toDecimalPlaces(2);
    return { requestedBaseAmount: refund.requestedBaseAmount ?? net.plus(promotion), promotionNettingBaseAmount: promotion, netBaseAmount: net, settlementAmount: refund.amount };
  });
  const calculation = calculateRefund({ grossOrderBaseAmount: paidBaseAmount.plus(order.discountTotal), promotionDiscountBaseAmount: order.discountTotal, paidBaseAmount, paidSettlementAmount: order.paymentIntent.amount, requestedGrossBaseAmount: rma.approvedRefundAmount, priorRefunds });
  const reference = createReference("RFD");
  const refund = await tx.refund.create({ data: { reference, orderId: order.id, paymentIntentId: order.paymentIntent.id, rmaId: rma.id, amount: calculation.settlementAmount, currency: order.paymentIntent.currency, requestedBaseAmount: calculation.requestedGrossBaseAmount, promotionNettingBaseAmount: calculation.promotionNettingBaseAmount, netBaseAmount: calculation.netBaseAmount, baseCurrency: order.currency, calculationVersion: calculation.version, requestFingerprint: input.requestFingerprint, reason: input.reason, destination: "ORIGINAL_METHOD", status: "PROCESSING", fxSnapshotId: fxSnapshot.id, idempotencyKey: input.idempotencyKey, approvedById: input.actorId, providerRefundTransactionId: reference } });
  await tx.auditLog.create({ data: { actorId: input.actorId, action: "refund.original_method_reserved", entityType: "Refund", entityId: refund.id, metadata: { orderId: order.id, rmaId: rma.id, paymentIntentId: order.paymentIntent.id, provider: order.paymentIntent.provider, amount: refund.amount.toFixed(2), currency: refund.currency, fxSnapshotId: fxSnapshot.id, calculationVersion: calculation.version } } });
  return { refund, bankTransactionId, replay: false };
}
