import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { decideSettlementResolution, SettlementResolutionError } from "@/modules/payments/reconciliation";
import { reconciliationDecisionDto } from "@/modules/payments/reconciliation-dto";

const schema = z.object({ decision: z.enum(["APPROVED", "REJECTED"]), reason: z.string().trim().min(10).max(1000) });
function hasFinanceAccess(session: Awaited<ReturnType<typeof getRequestSession>>) {
  return Boolean(session && ((session.portal === "finance" && session.roles.includes(ROLE.FINANCE)) || (session.portal === "admin" && session.roles.includes(ROLE.ADMIN))));
}

export async function POST(request: NextRequest, context: { params: Promise<{ proposalId: string }> }) {
  const session = await getRequestSession(request);
  if (!hasFinanceAccess(session)) return apiError("FINANCE_ACCESS_REQUIRED", "MFA-verified Finance or Admin access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "A reconciliation decision must originate from the protected application.", 403);
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
  if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 200) return apiError("IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required.", 400);
  const { proposalId } = await context.params;
  if (!z.string().uuid().safeParse(proposalId).success) return apiError("VALIDATION_ERROR", "The proposal identifier is invalid.", 422);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Check the independent review decision.", 422, z.treeifyError(parsed.error));
  try {
    const result = await prisma.$transaction((tx) => decideSettlementResolution(tx, { proposalId, ...parsed.data, reviewedById: session!.userId, idempotencyKey }), { isolationLevel: "Serializable" });
    return apiSuccess({ resolutionDecision: reconciliationDecisionDto(result.resolutionDecision), idempotentReplay: result.replay }, { status: result.replay ? 200 : 201, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    if (error instanceof SettlementResolutionError) {
      const status = error.code === "NOT_FOUND" ? 404 : error.code === "INDEPENDENT_REVIEW_REQUIRED" ? 403 : 409;
      return apiError(error.code === "IDEMPOTENCY_CONFLICT" ? "IDEMPOTENCY_KEY_REUSED" : `SETTLEMENT_${error.code}`, error.message, status);
    }
    if ((error as { code?: string }).code === "P2034") return apiError("SETTLEMENT_RETRY_REQUIRED", "Concurrent reconciliation evidence changed. Refresh and retry.", 409);
    if ((error as { code?: string }).code === "P2002") return apiError("SETTLEMENT_DECISION_CONFLICT", "This proposal or exception already has a final decision. Refresh the queue.", 409);
    throw error;
  }
}
