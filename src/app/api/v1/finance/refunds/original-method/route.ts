import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { RefundCalculationError } from "@/modules/refunds/calculation";
import { originalRefundFingerprint, OriginalMethodRefundError, reserveOriginalMethodRefund } from "@/modules/refunds/original-method";
import { initiateSslCommerzRefund, SslCommerzError, type SslCommerzConfig } from "@/modules/payments/sslcommerz";

const schema = z.object({ orderId: z.string().uuid(), rmaId: z.string().uuid(), reason: z.string().trim().min(5).max(255) });

function config(): SslCommerzConfig | null {
  const environment = process.env.SSLCOMMERZ_ENVIRONMENT?.trim().toLowerCase();
  const storeId = process.env.SSLCOMMERZ_STORE_ID?.trim();
  const storePassword = process.env.SSLCOMMERZ_STORE_PASSWORD?.trim();
  if ((environment !== "sandbox" && environment !== "live") || !storeId || !storePassword) return null;
  return { environment, storeId, storePassword, appBaseUrl: process.env.APP_BASE_URL ?? "http://localhost:3000" };
}

function dto(refund: { id: string; reference: string; amount: unknown; currency: string; status: string; providerStatus: string | null; providerRefundReference: string | null }) {
  return { id: refund.id, reference: refund.reference, amount: refund.amount, currency: refund.currency, status: refund.status, providerStatus: refund.providerStatus, providerRefundReference: refund.providerRefundReference };
}

export async function GET(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session || session.portal !== "finance" || !session.roles.includes(ROLE.FINANCE)) return apiError("FINANCE_ACCESS_REQUIRED", "MFA-verified Finance access is required.", 403);
  const refunds = await prisma.refund.findMany({ where: { destination: "ORIGINAL_METHOD" }, select: { id: true, reference: true, amount: true, currency: true, status: true, providerStatus: true, providerRefundReference: true, providerStatusCheckedAt: true, createdAt: true, order: { select: { orderNumber: true } }, rma: { select: { reference: true } } }, orderBy: { createdAt: "desc" }, take: 100 });
  const now = Date.now();
  return apiSuccess({ refunds: refunds.map((refund) => ({ ...dto(refund), orderNumber: refund.order.orderNumber, rmaReference: refund.rma?.reference ?? null, providerStatusCheckedAt: refund.providerStatusCheckedAt, createdAt: refund.createdAt, attentionRequired: refund.status === "PROCESSING" && (now - refund.createdAt.getTime() >= 24 * 60 * 60_000 || !refund.providerRefundReference) })) }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function POST(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session || session.portal !== "finance" || !session.roles.includes(ROLE.FINANCE)) return apiError("FINANCE_ACCESS_REQUIRED", "MFA-verified Finance access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "Refund initiation must originate from the protected Finance application.", 403);
  const configured = config();
  if (!configured) return apiError("PAYMENT_GATEWAY_UNAVAILABLE", "SSLCommerz refund credentials are not configured on the server.", 503);
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
  if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 200) return apiError("IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required.", 400);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Check the approved refund details.", 422, z.treeifyError(parsed.error));
  const requestFingerprint = originalRefundFingerprint(parsed.data);
  let reservation: Awaited<ReturnType<typeof reserveOriginalMethodRefund>>;
  try {
    reservation = await prisma.$transaction((tx) => reserveOriginalMethodRefund(tx, { ...parsed.data, actorId: session.userId, idempotencyKey, requestFingerprint }), { isolationLevel: "Serializable" });
  } catch (error) {
    if (error instanceof OriginalMethodRefundError) return apiError(error.code, error.message, 409);
    if (error instanceof RefundCalculationError) return apiError(error.code, error.message, 409);
    if ((error as { code?: string }).code === "P2034") return apiError("REFUND_RETRY_REQUIRED", "Concurrent refund evidence changed. Review the claim and retry with a new request key.", 409);
    throw error;
  }
  if (reservation.refund.providerRefundReference) return apiSuccess({ refund: dto(reservation.refund), idempotentReplay: true }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  const operationKey = `refund-initiate:${idempotencyKey}`;
  const previousOperation = await prisma.refundGatewayOperation.findUnique({ where: { idempotencyKey: operationKey } });
  if (previousOperation) return apiSuccess({ refund: dto(reservation.refund), idempotentReplay: true, attentionRequired: previousOperation.outcome !== "INITIATED" }, { status: 202, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  try {
    const result = await initiateSslCommerzRefund({ bankTransactionId: reservation.bankTransactionId, refundTransactionId: reservation.refund.providerRefundTransactionId!, amount: reservation.refund.amount.toString(), remarks: parsed.data.reason, reference: reservation.refund.reference }, configured);
    const updated = await prisma.$transaction(async (tx) => {
      await tx.refundGatewayOperation.create({ data: { refundId: reservation.refund.id, operation: "INITIATE", provider: "SSLCOMMERZ", outcome: "INITIATED", providerStatus: result.providerStatus, providerRefundReference: result.providerRefundReference, providerTransactionId: result.providerTransactionId, bankTransactionId: result.bankTransactionId, responseEvidence: { outcome: result.outcome }, idempotencyKey: operationKey, requestFingerprint, actorId: session.userId } });
      const refund = await tx.refund.update({ where: { id: reservation.refund.id }, data: { providerRefundReference: result.providerRefundReference, providerStatus: result.providerStatus, providerStatusCheckedAt: new Date() } });
      await tx.auditLog.create({ data: { actorId: session.userId, action: "refund.original_method_initiated", entityType: "Refund", entityId: refund.id, metadata: { provider: "SSLCOMMERZ", providerStatus: result.providerStatus, providerRefundReference: result.providerRefundReference } } });
      return refund;
    });
    return apiSuccess({ refund: dto(updated), idempotentReplay: reservation.replay }, { status: reservation.replay ? 200 : 201, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    if (error instanceof SslCommerzError) {
      const rejected = error.code === "REFUND_REJECTED";
      await prisma.$transaction(async (tx) => {
        await tx.refundGatewayOperation.create({ data: { refundId: reservation.refund.id, operation: "INITIATE", provider: "SSLCOMMERZ", outcome: rejected ? "REJECTED" : "UNKNOWN", idempotencyKey: operationKey, requestFingerprint, actorId: session.userId, responseEvidence: { errorCode: error.code } } });
        if (rejected) await tx.refund.update({ where: { id: reservation.refund.id }, data: { status: "FAILED", providerStatus: "failed", providerStatusCheckedAt: new Date() } });
        await tx.auditLog.create({ data: { actorId: session.userId, action: rejected ? "refund.original_method_rejected" : "refund.original_method_unknown", entityType: "Refund", entityId: reservation.refund.id, metadata: { provider: "SSLCOMMERZ", errorCode: error.code } } });
      });
      return apiError(rejected ? "REFUND_REJECTED" : "REFUND_STATUS_UNKNOWN", rejected ? "SSLCommerz rejected the refund. Review the evidence before creating a new request." : "The provider result is uncertain. Do not create another refund; investigate using the recorded refund transaction ID.", rejected ? 409 : 502);
    }
    if ((error as { code?: string }).code === "P2002") {
      const current = await prisma.refund.findUniqueOrThrow({ where: { id: reservation.refund.id } });
      return apiSuccess({ refund: dto(current), idempotentReplay: true }, { status: 200, headers: { "Cache-Control": "private, no-store, max-age=0" } });
    }
    throw error;
  }
}
