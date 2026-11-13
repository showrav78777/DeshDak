import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { ComplianceCatalogAccessError, runComplianceCatalogMaintenance } from "@/modules/maintenance/compliance-catalog";

export async function POST(request: NextRequest) {
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "Compliance maintenance must originate from the protected Admin application.", 403);
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") return apiError("ADMIN_ACCESS_REQUIRED", "Administrator access is required.", 403);
  try {
    const result = await runComplianceCatalogMaintenance({ triggerSource: "ADMIN", triggeredById: session.userId, sessionId: session.sessionId });
    return apiSuccess({ runId: result.run.id, status: result.run.status, skipped: result.skipped, summary: result.run.summary }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    if (error instanceof ComplianceCatalogAccessError) return apiError("ADMIN_ACCESS_REQUIRED", "Your catalog-maintenance access changed. Sign in again before running maintenance.", 403);
    return apiError("COMPLIANCE_MAINTENANCE_FAILED", "Catalog compliance maintenance failed safely. Review the recorded job status before retrying.", 500);
  }
}
