import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { createReference } from "@/lib/reference";
import { ROLE } from "@/lib/roles";
import { canTransitionOrder } from "@/modules/orders/state-machine";
import { calculateRefund, RefundCalculationError } from "@/modules/refunds/calculation";
import { createTransactionalNotification } from "@/modules/notifications/service";
import { ensureWallet, postWalletTransaction } from "@/modules/wallet/ledger";

const amount = z.coerce.number().positive().max(100_000_000).optional();
const schema = z.object({ orderId: z.string().uuid(), rmaId: z.string().uuid().optional(), grossAmount: amount, amount, reason: z.string().trim().min(5).max(1000), walletConsentConfirmed: z.boolean().default(false) })
  .refine((value) => value.grossAmount !== undefined || value.amount !== undefined, { message: "Enter the approved gross refund amount." });

function fingerprint(input: { orderId: string; rmaId?: string; grossAmount: Prisma.Decimal; reason: string }) {
  return createHash("sha256").update(JSON.stringify({ orderId: input.orderId, rmaId: input.rmaId ?? null, grossAmount: input.grossAmount.toFixed(2), reason: input.reason, destination: "WALLET" })).digest("hex");
}

type RefundResult = { id: string; reference: string; orderId: string; amount: Prisma.Decimal; currency: string; destination: string; status: string; processedAt: Date | null; requestedBaseAmount: Prisma.Decimal | null; promotionNettingBaseAmount: Prisma.Decimal | null; netBaseAmount: Prisma.Decimal | null; baseCurrency: string | null; calculationVersion: string | null };
function refundResponse(refund: RefundResult, replay: boolean) {
  return apiSuccess({ refund: { id: refund.id, reference: refund.reference, orderId: refund.orderId, amount: refund.amount, currency: refund.currency, destination: refund.destination, status: refund.status, processedAt: refund.processedAt, calculation: { requestedGrossAmount: refund.requestedBaseAmount, promotionNetted: refund.promotionNettingBaseAmount, netBaseAmount: refund.netBaseAmount, baseCurrency: refund.baseCurrency, version: refund.calculationVersion } }, idempotentReplay: replay }, { status: replay ? 200 : 201, headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function POST(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session || (!session.roles.includes(ROLE.ADMIN) && !session.roles.includes(ROLE.FINANCE))) return apiError("FINANCE_ACCESS_REQUIRED", "Finance access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "This financial action must originate from a protected application.", 403);
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
  if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 200) return apiError("IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required.", 400);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Check the refund details.", 422, z.treeifyError(parsed.error));
  if (session.roles.includes(ROLE.FINANCE) && !parsed.data.rmaId) return apiError("APPROVED_CLAIM_REQUIRED", "Finance can post only an evidence-based claim already approved for this exact amount.", 409);
  const requestedGrossAmount = new Prisma.Decimal(parsed.data.grossAmount ?? parsed.data.amount!);
  const requestFingerprint = fingerprint({ orderId: parsed.data.orderId, rmaId: parsed.data.rmaId, grossAmount: requestedGrossAmount, reason: parsed.data.reason });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.refund.findUnique({ where: { idempotencyKey } });
      if (existing) {
        if (existing.requestFingerprint !== requestFingerprint) throw new Error("IDEMPOTENCY_KEY_PAYLOAD_MISMATCH");
        return { refund: existing, replay: true };
      }
      const order = await tx.order.findUnique({ where: { id: parsed.data.orderId }, include: { customer: { select: { accountType: true } }, paymentIntent: { include: { fxSnapshot: true } }, refunds: { where: { status: { in: ["PENDING_APPROVAL", "APPROVED", "SUCCEEDED"] } }, select: { amount: true, requestedBaseAmount: true, promotionNettingBaseAmount: true, netBaseAmount: true } } } });
      if (!order?.paymentIntent || order.paymentIntent.status !== "SUCCEEDED") throw new Error("ORDER_NOT_REFUNDABLE");
      if (order.paymentIntent.provider !== "WALLET" && !parsed.data.walletConsentConfirmed) throw new Error("WALLET_REFUND_CONSENT_REQUIRED");
      const rma = parsed.data.rmaId ? await tx.rma.findUnique({
        where: { id: parsed.data.rmaId },
        include: { refunds: { where: { status: { in: ["PENDING_APPROVAL", "APPROVED", "SUCCEEDED"] } }, select: { id: true } } },
      }) : null;
      if (parsed.data.rmaId && (!rma || rma.orderId !== order.id || rma.status !== "INSPECTED" || !["FULL_REFUND", "PARTIAL_REFUND"].includes(rma.decision) || !rma.approvedRefundAmount || !rma.approvedRefundAmount.equals(requestedGrossAmount) || rma.refunds.length)) throw new Error("RMA_REFUND_NOT_APPROVED");
      if (session.roles.includes(ROLE.FINANCE) && (!rma?.refundDecisionById || !rma.refundDecisionAt)) throw new Error("REFUND_DECISION_EVIDENCE_REQUIRED");
      if (session.roles.includes(ROLE.FINANCE) && rma?.refundDecisionById === session.userId) throw new Error("INDEPENDENT_REFUND_APPROVER_REQUIRED");

      let fxSnapshot = order.paymentIntent.fxSnapshot;
      if (!fxSnapshot) {
        if (order.currency !== "BDT" || order.paymentIntent.currency !== "BDT") throw new Error("ORIGINAL_FX_SNAPSHOT_REQUIRED");
        fxSnapshot = await tx.fxSnapshot.create({ data: { pair: "BDT_BDT", baseCurrency: "BDT", quoteCurrency: "BDT", baseAmount: order.paymentIntent.amount, convertedAmount: order.paymentIntent.amount, customerSegment: order.customer.accountType, rateUsed: 1, spreadApplied: 0, source: "BDT_PARITY_LEGACY_PAYMENT", contextType: "PAYMENT", contextId: order.paymentIntent.id } });
        await tx.paymentIntent.update({ where: { id: order.paymentIntent.id }, data: { fxSnapshotId: fxSnapshot.id } });
      }
      if (!fxSnapshot.baseAmount || fxSnapshot.baseCurrency !== order.currency || fxSnapshot.quoteCurrency !== order.paymentIntent.currency) throw new Error("ORIGINAL_FX_SNAPSHOT_REQUIRED");

      const paidBaseAmount = fxSnapshot.baseAmount;
      const priorRefunds = order.refunds.map((refund) => {
        const legacyNetBase = refund.amount.mul(paidBaseAmount).div(order.paymentIntent!.amount).toDecimalPlaces(2);
        const promotion = refund.promotionNettingBaseAmount ?? new Prisma.Decimal(0);
        const net = refund.netBaseAmount ?? legacyNetBase;
        return { requestedBaseAmount: refund.requestedBaseAmount ?? net.plus(promotion), promotionNettingBaseAmount: promotion, netBaseAmount: net, settlementAmount: refund.amount };
      });
      const calculation = calculateRefund({ grossOrderBaseAmount: paidBaseAmount.plus(order.discountTotal), promotionDiscountBaseAmount: order.discountTotal, paidBaseAmount, paidSettlementAmount: order.paymentIntent.amount, requestedGrossBaseAmount: requestedGrossAmount, priorRefunds });
      const wallet = await ensureWallet(tx, order.customerId, order.paymentIntent.currency);
      const created = await tx.refund.create({ data: { reference: createReference("RFD"), orderId: order.id, paymentIntentId: order.paymentIntent.id, rmaId: rma?.id, walletId: wallet.id, amount: calculation.settlementAmount, currency: order.paymentIntent.currency, requestedBaseAmount: calculation.requestedGrossBaseAmount, promotionNettingBaseAmount: calculation.promotionNettingBaseAmount, netBaseAmount: calculation.netBaseAmount, baseCurrency: order.currency, calculationVersion: calculation.version, requestFingerprint, reason: parsed.data.reason, destination: "WALLET", status: "SUCCEEDED", fxSnapshotId: fxSnapshot.id, idempotencyKey, approvedById: session.userId, processedAt: new Date() } });
      await postWalletTransaction(tx, { userId: order.customerId, currency: order.paymentIntent.currency, amount: calculation.settlementAmount, direction: "CREDIT", type: "REFUND_CREDIT", idempotencyKey: `wallet-refund:${idempotencyKey}`, description: `Refund ${created.reference}: ${parsed.data.reason}`, sourceType: "REFUND", sourceId: created.id, debitAccountCode: "CUSTOMER_REFUND_CLEARING", creditAccountCode: "CUSTOMER_WALLET_LIABILITY" });
      if (calculation.remainingSettlementAmount.isZero() && canTransitionOrder(order.status, "REFUNDED")) {
        const moved = await tx.order.updateMany({ where: { id: order.id, status: order.status }, data: { status: "REFUNDED" } });
        if (moved.count !== 1) throw new Error("REFUND_RETRY_REQUIRED");
        await tx.orderStatusHistory.create({ data: { orderId: order.id, fromStatus: order.status, toStatus: "REFUNDED", actorId: session.userId, note: `Full approved refund completed as ${created.reference}.` } });
      }
      if (rma) {
        const resolved = await tx.rma.updateMany({ where: { id: rma.id, status: "INSPECTED", version: rma.version }, data: { status: "REFUNDED", resolvedAt: new Date(), version: { increment: 1 } } });
        if (resolved.count !== 1) throw new Error("RMA_REFUND_STATE_CHANGED");
        await tx.rmaEvent.create({ data: { rmaId: rma.id, fromStatus: "INSPECTED", toStatus: "REFUNDED", actorId: session.userId, note: `Approved refund posted as ${created.reference}.`, metadata: { refundId: created.id, settlementAmount: calculation.settlementAmount.toFixed(2), settlementCurrency: order.paymentIntent.currency } } });
        await createTransactionalNotification(tx, { userId: order.customerId, eventType: "RMA_REFUNDED", title: `Refund completed for ${rma.reference}`, body: `${order.paymentIntent.currency} ${calculation.settlementAmount.toFixed(2)} was credited securely to your app wallet.`, deepLink: `/rmas/${rma.id}`, entityType: "Rma", entityId: rma.id, priority: "HIGH", idempotencyKey: `rma-notification:refunded:${rma.id}` });
      }
      await tx.auditLog.create({ data: { actorId: session.userId, action: "refund.wallet_posted", entityType: "Refund", entityId: created.id, metadata: { orderId: order.id, rmaId: rma?.id, paymentIntentId: order.paymentIntent.id, customerId: order.customerId, requestedGrossBaseAmount: calculation.requestedGrossBaseAmount.toFixed(2), promotionNettingBaseAmount: calculation.promotionNettingBaseAmount.toFixed(2), netBaseAmount: calculation.netBaseAmount.toFixed(2), baseCurrency: order.currency, settlementAmount: calculation.settlementAmount.toFixed(2), settlementCurrency: order.paymentIntent.currency, fxSnapshotId: fxSnapshot.id, calculationVersion: calculation.version, originalPaymentProvider: order.paymentIntent.provider, walletConsentConfirmed: parsed.data.walletConsentConfirmed } } });
      return { refund: created, replay: false };
    }, { isolationLevel: "Serializable" });
    return refundResponse(result.refund, result.replay);
  } catch (error) {
    if (error instanceof RefundCalculationError) {
      if (error.code === "REFUND_AMOUNT_TOO_HIGH" || error.code === "NOTHING_LEFT_TO_REFUND") return apiError("REFUND_AMOUNT_TOO_HIGH", "The approved gross refund exceeds the remaining refundable order amount.", 409);
      return apiError("REFUND_CALCULATION_INVALID", "The original payment and promotional amounts do not form a valid refund basis.", 409);
    }
    if ((error as Error).message === "ORDER_NOT_REFUNDABLE") return apiError("ORDER_NOT_REFUNDABLE", "This order does not have a verified successful payment.", 409);
    if ((error as Error).message === "RMA_REFUND_NOT_APPROVED") return apiError("RMA_REFUND_NOT_APPROVED", "The claim is not approved for this exact refund amount, or it was already processed.", 409);
    if ((error as Error).message === "REFUND_DECISION_EVIDENCE_REQUIRED") return apiError("REFUND_DECISION_EVIDENCE_REQUIRED", "The claim must preserve its named Admin decision-maker and decision time before Finance can post it.", 409);
    if ((error as Error).message === "INDEPENDENT_REFUND_APPROVER_REQUIRED") return apiError("INDEPENDENT_REFUND_APPROVER_REQUIRED", "The same person cannot approve the claim and post its financial refund.", 409);
    if ((error as Error).message === "RMA_REFUND_STATE_CHANGED") return apiError("RMA_REFUND_STATE_CHANGED", "The claim changed during financial processing. Review the claim and refund ledger before retrying.", 409);
    if ((error as Error).message === "WALLET_REFUND_CONSENT_REQUIRED") return apiError("WALLET_REFUND_CONSENT_REQUIRED", "The customer must explicitly agree before an external payment is refunded to the app wallet.", 409);
    if ((error as Error).message === "ORIGINAL_FX_SNAPSHOT_REQUIRED") return apiError("ORIGINAL_FX_SNAPSHOT_REQUIRED", "This payment cannot be refunded until its original FX snapshot is available.", 409);
    if ((error as Error).message === "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH") return apiError("IDEMPOTENCY_KEY_PAYLOAD_MISMATCH", "This Idempotency-Key was already used for different refund details.", 409);
    if ((error as Error).message === "REFUND_RETRY_REQUIRED") return apiError("REFUND_RETRY_REQUIRED", "Another financial action changed this order. Review the current refundable balance and retry with a new Idempotency-Key.", 409);
    if ((error as { code?: string }).code === "P2034") return apiError("REFUND_RETRY_REQUIRED", "Another financial action changed this order. Review the current refundable balance and retry with a new Idempotency-Key.", 409);
    if ((error as { code?: string }).code === "P2002") {
      const replay = await prisma.refund.findUnique({ where: { idempotencyKey } });
      if (replay?.requestFingerprint === requestFingerprint) return refundResponse(replay, true);
      return apiError("IDEMPOTENCY_KEY_PAYLOAD_MISMATCH", "This Idempotency-Key was already used for different refund details.", 409);
    }
    throw error;
  }
}
