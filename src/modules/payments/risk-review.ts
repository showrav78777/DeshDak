import { createHash } from "node:crypto";
import { Prisma, type PaymentRiskDecisionType, type PaymentStatus } from "@prisma/client";
import { z } from "zod";
import { createOrderFromPaidPayment } from "@/modules/orders/create-from-payment";

const heldEvidenceSchema = z.object({
  validationId: z.string().min(1).max(100),
  bankTransactionId: z.string().max(100).nullable(),
  providerStatus: z.enum(["VALID", "VALIDATED"]),
  riskLevel: z.literal(1),
  riskTitle: z.string().max(255).nullable(),
});

export class PaymentRiskReviewError extends Error {
  readonly code: "NOT_FOUND" | "NOT_REVIEWABLE" | "IDEMPOTENCY_CONFLICT";
  constructor(code: "NOT_FOUND" | "NOT_REVIEWABLE" | "IDEMPOTENCY_CONFLICT", message: string) { super(message); this.name = "PaymentRiskReviewError"; this.code = code; }
}

function fingerprint(input: { paymentId: string; decision: PaymentRiskDecisionType; reason: string }) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function gatewayObject(value: Prisma.JsonValue | null): Record<string, Prisma.JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, Prisma.JsonValue> : {};
}

export async function reviewSslCommerzRiskPayment(tx: Prisma.TransactionClient, input: { paymentId: string; decision: PaymentRiskDecisionType; reason: string; reviewerId: string; idempotencyKey: string }) {
  const reason = input.reason.trim();
  const requestFingerprint = fingerprint({ paymentId: input.paymentId, decision: input.decision, reason });
  const replay = await tx.paymentRiskDecision.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (replay) {
    if (replay.paymentIntentId !== input.paymentId || replay.reviewedById !== input.reviewerId || replay.requestFingerprint !== requestFingerprint) throw new PaymentRiskReviewError("IDEMPOTENCY_CONFLICT", "This request key was already used for another decision.");
    const payment = await tx.paymentIntent.findUniqueOrThrow({ where: { id: replay.paymentIntentId }, select: { status: true, orderId: true } });
    return { riskDecision: replay, paymentStatus: payment.status, orderId: payment.orderId, replay: true };
  }

  const payment = await tx.paymentIntent.findUnique({ where: { id: input.paymentId }, include: { riskDecision: true } });
  if (!payment) throw new PaymentRiskReviewError("NOT_FOUND", "Payment was not found.");
  if (payment.riskDecision) throw new PaymentRiskReviewError("NOT_REVIEWABLE", "This payment already has a final risk decision.");
  const gateway = gatewayObject(payment.gatewayPayload);
  const evidence = heldEvidenceSchema.safeParse(gateway.evidence);
  if (payment.provider !== "SSLCOMMERZ" || payment.status !== "PENDING" || gateway.reviewRequired !== true || !evidence.success) {
    throw new PaymentRiskReviewError("NOT_REVIEWABLE", "This payment is not awaiting SSLCommerz risk review.");
  }

  const riskDecision = await tx.paymentRiskDecision.create({ data: {
    paymentIntentId: payment.id,
    decision: input.decision,
    reason,
    evidenceSnapshot: evidence.data,
    amountSnapshot: payment.amount,
    currencySnapshot: payment.currency,
    reviewedById: input.reviewerId,
    idempotencyKey: input.idempotencyKey,
    requestFingerprint,
  } });

  let orderId = payment.orderId;
  let paymentStatus: PaymentStatus = payment.status;
  if (input.decision === "APPROVED") {
    const paid = await tx.paymentIntent.update({ where: { id: payment.id }, data: {
      status: "SUCCEEDED",
      providerTransactionId: evidence.data.validationId,
      gatewayPayload: { ...gateway, reviewRequired: false, riskDecision: "APPROVED", riskDecisionId: riskDecision.id },
    } });
    const order = await createOrderFromPaidPayment(tx, paid);
    orderId = order.id;
    paymentStatus = paid.status;
  } else {
    await tx.paymentIntent.update({ where: { id: payment.id }, data: { gatewayPayload: { ...gateway, reviewRequired: false, riskDecision: "REJECTED", riskDecisionId: riskDecision.id, financialResolutionRequired: true } } });
  }
  await tx.auditLog.create({ data: {
    actorId: input.reviewerId,
    action: input.decision === "APPROVED" ? "sslcommerz.risk_payment_approved" : "sslcommerz.risk_payment_rejected",
    entityType: "PaymentIntent",
    entityId: payment.id,
    metadata: { riskDecisionId: riskDecision.id, reason, amount: payment.amount.toString(), currency: payment.currency, financialResolutionRequired: input.decision === "REJECTED" },
  } });
  return { riskDecision, paymentStatus, orderId, replay: false };
}
