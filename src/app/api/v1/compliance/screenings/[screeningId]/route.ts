import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { decideComplianceScreening } from "@/modules/compliance/review";
import { complianceDecisionSchema } from "@/modules/compliance/schemas";

export async function PATCH(request: NextRequest, context: RouteContext<"/api/v1/compliance/screenings/[screeningId]">) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.COMPLIANCE) || session.portal !== "compliance") return apiError("COMPLIANCE_ACCESS_REQUIRED", "Verified Compliance access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "Compliance decisions must originate from the protected Compliance application.", 403);
  const parsed = complianceDecisionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Choose a decision and provide a review note.", 422, { fields: parsed.error.flatten().fieldErrors });
  const { screeningId } = await context.params;
  const result = await decideComplianceScreening({ screeningId, reviewerId: session.userId, ...parsed.data });
  if (result.outcome === "NOT_FOUND") return apiError("SCREENING_NOT_FOUND", "Compliance screening not found.", 404);
  if (result.outcome === "STATE_CONFLICT") return apiError("SCREENING_STATE_CONFLICT", "Only a pending manual review can be decided.", 409);
  if (result.outcome === "VERSION_CONFLICT") return apiError("SCREENING_VERSION_CONFLICT", "This screening changed in another session. Refresh and try again.", 409);
  return apiSuccess({ screening: result.screening }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
