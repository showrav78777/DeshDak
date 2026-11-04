import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { PaymentRiskReviewError, reviewSslCommerzRiskPayment } from "@/modules/payments/risk-review";

const schema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  reason: z.string().trim().min(10).max(1000),
});

export async function POST(request: NextRequest, context: RouteContext<"/api/v1/admin/payment-risk/[paymentId]/decision">) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin" || !session.mfaVerifiedAt) return apiError("ADMIN_MFA_REQUIRED", "Administrator access with completed MFA is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "Payment decisions must originate from the protected Admin application.", 403);
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
  if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 255) return apiError("IDEMPOTENCY_KEY_REQUIRED", "Send a unique Idempotency-Key for this payment decision.", 422);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Choose a decision and provide a clear reason of at least 10 characters.", 422, { fields: parsed.error.flatten().fieldErrors });
  const { paymentId } = await context.params;
  try {
    const result = await prisma.$transaction((tx) => reviewSslCommerzRiskPayment(tx, { paymentId, reviewerId: session.userId, idempotencyKey, ...parsed.data }), { isolationLevel: "Serializable" });
    return apiSuccess({ decision: { id: result.riskDecision.id, paymentIntentId: result.riskDecision.paymentIntentId, decision: result.riskDecision.decision, reason: result.riskDecision.reason, reviewedAt: result.riskDecision.reviewedAt }, paymentStatus: result.paymentStatus, orderId: result.orderId, idempotentReplay: result.replay }, { status: result.replay ? 200 : 201, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    if (error instanceof PaymentRiskReviewError) {
      if (error.code === "NOT_FOUND") return apiError("PAYMENT_NOT_FOUND", error.message, 404);
      if (error.code === "IDEMPOTENCY_CONFLICT") return apiError("IDEMPOTENCY_KEY_REUSED", error.message, 409);
      return apiError("PAYMENT_RISK_STATE_CONFLICT", error.message, 409);
    }
    if ((error as { code?: string }).code === "P2002") return apiError("PAYMENT_RISK_STATE_CONFLICT", "This payment was already decided in another session.", 409);
    if ((error as { code?: string }).code === "P2034") return apiError("PAYMENT_RETRY_REQUIRED", "The payment changed in another session. Refresh and retry safely.", 409);
    throw error;
  }
}
