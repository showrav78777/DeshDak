import { createHash } from "node:crypto";
import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { sslCommerzBankTransactionId } from "@/modules/refunds/original-method";
import { initiateSslCommerzRefund, SslCommerzError, type SslCommerzConfig } from "@/modules/payments/sslcommerz";

function config(): SslCommerzConfig | null { const environment = process.env.SSLCOMMERZ_ENVIRONMENT?.trim().toLowerCase(); const storeId = process.env.SSLCOMMERZ_STORE_ID?.trim(); const storePassword = process.env.SSLCOMMERZ_STORE_PASSWORD?.trim(); return (environment === "sandbox" || environment === "live") && storeId && storePassword ? { environment, storeId, storePassword, appBaseUrl: process.env.APP_BASE_URL ?? "http://localhost:3000" } : null; }

export async function POST(request: NextRequest, context: { params: Promise<{ refundId: string }> }) {
  const session = await getRequestSession(request);
  if (!session || session.portal !== "finance" || !session.roles.includes(ROLE.FINANCE)) return apiError("FINANCE_ACCESS_REQUIRED", "MFA-verified Finance access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "Refund recovery must originate from the protected Finance application.", 403);
  const configured = config(); if (!configured) return apiError("PAYMENT_GATEWAY_UNAVAILABLE", "SSLCommerz refund credentials are not configured on the server.", 503);
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim(); if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 200) return apiError("IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required.", 400);
  const { refundId } = await context.params;
  const operationKey = `refund-retry:${idempotencyKey}`;
  const previous = await prisma.refundGatewayOperation.findUnique({ where: { idempotencyKey: operationKey }, include: { refund: true } });
  if (previous) return apiSuccess({ refund: { id: previous.refund.id, reference: previous.refund.reference, status: previous.refund.status, providerStatus: previous.refund.providerStatus, providerRefundReference: previous.refund.providerRefundReference }, idempotentReplay: true }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  const refund = await prisma.refund.findFirst({ where: { id: refundId, destination: "ORIGINAL_METHOD", status: "PROCESSING", providerRefundReference: null, providerRefundTransactionId: { not: null }, paymentIntent: { provider: "SSLCOMMERZ", status: "SUCCEEDED", settlementEntries: { some: { matchStatus: "MATCHED" } } }, gatewayOperations: { some: { operation: "INITIATE", outcome: "UNKNOWN" } } }, include: { paymentIntent: true } });
  if (!refund?.providerRefundTransactionId) return apiError("REFUND_RECOVERY_NOT_ALLOWED", "Only an uncertain reserved initiation without a provider reference can use recovery.", 409);
  const bankTransactionId = sslCommerzBankTransactionId(refund.paymentIntent.gatewayPayload);
  if (!bankTransactionId) return apiError("VERIFIED_BANK_TRANSACTION_REQUIRED", "Verified bank transaction evidence is unavailable.", 409);
  const requestFingerprint = createHash("sha256").update(JSON.stringify({ refundId, providerRefundTransactionId: refund.providerRefundTransactionId })).digest("hex");
  try {
    const result = await initiateSslCommerzRefund({ bankTransactionId, refundTransactionId: refund.providerRefundTransactionId, amount: refund.amount.toString(), remarks: refund.reason, reference: refund.reference }, configured);
    const updated = await prisma.$transaction(async (tx) => {
      await tx.refundGatewayOperation.create({ data: { refundId, operation: "INITIATE", provider: "SSLCOMMERZ", outcome: "RECOVERED", providerStatus: result.providerStatus, providerRefundReference: result.providerRefundReference, providerTransactionId: result.providerTransactionId, bankTransactionId: result.bankTransactionId, responseEvidence: { adapterOutcome: result.outcome, recovery: true }, idempotencyKey: operationKey, requestFingerprint, actorId: session.userId } });
      const row = await tx.refund.update({ where: { id: refundId }, data: { providerRefundReference: result.providerRefundReference, providerStatus: result.providerStatus, providerStatusCheckedAt: new Date() } });
      await tx.auditLog.create({ data: { actorId: session.userId, action: "refund.original_method_initiation_recovered", entityType: "Refund", entityId: refundId, metadata: { provider: "SSLCOMMERZ", providerStatus: result.providerStatus, providerRefundReference: result.providerRefundReference, reusedRefundTransactionId: true } } });
      return row;
    });
    return apiSuccess({ refund: { id: updated.id, reference: updated.reference, status: updated.status, providerStatus: updated.providerStatus, providerRefundReference: updated.providerRefundReference }, idempotentReplay: false });
  } catch (error) {
    if (error instanceof SslCommerzError) {
      const rejected = error.code === "REFUND_REJECTED";
      await prisma.$transaction(async (tx) => { await tx.refundGatewayOperation.create({ data: { refundId, operation: "INITIATE", provider: "SSLCOMMERZ", outcome: rejected ? "REJECTED" : "UNKNOWN", responseEvidence: { errorCode: error.code, recovery: true }, idempotencyKey: operationKey, requestFingerprint, actorId: session.userId } }); if (rejected) await tx.refund.update({ where: { id: refundId }, data: { status: "FAILED", providerStatus: "failed", providerStatusCheckedAt: new Date() } }); await tx.auditLog.create({ data: { actorId: session.userId, action: rejected ? "refund.original_method_recovery_rejected" : "refund.original_method_recovery_unknown", entityType: "Refund", entityId: refundId, metadata: { provider: "SSLCOMMERZ", errorCode: error.code, reusedRefundTransactionId: true } } }); });
      return apiError(rejected ? "REFUND_REJECTED" : "REFUND_STATUS_UNKNOWN", rejected ? "SSLCommerz rejected the recovered request." : "The recovery result is still uncertain. Do not create another refund.", rejected ? 409 : 502);
    }
    if ((error as { code?: string }).code === "P2002") { const current = await prisma.refund.findUniqueOrThrow({ where: { id: refundId } }); return apiSuccess({ refund: { id: current.id, reference: current.reference, status: current.status, providerStatus: current.providerStatus, providerRefundReference: current.providerRefundReference }, idempotentReplay: true }); }
    throw error;
  }
}
