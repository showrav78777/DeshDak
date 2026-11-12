import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { runSecurityCleanup } from "@/modules/maintenance/security-cleanup";

export async function POST(request: NextRequest) {
  if (!hasTrustedMutationOrigin(request)) return apiError("INVALID_ORIGIN", "The request origin could not be verified.", 403);
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin" || !session.mfaVerifiedAt) return apiError("ADMIN_ACCESS_REQUIRED", "Administrator access with completed MFA is required.", 403);
  try {
    const result = await runSecurityCleanup({ triggerSource: "ADMIN", triggeredById: session.userId });
    return apiSuccess({ runId: result.run.id, status: result.run.status, skipped: result.skipped, summary: result.run.summary });
  } catch {
    return apiError("MAINTENANCE_RUN_FAILED", "The cleanup failed safely. Review platform logs and the job status before retrying.", 500);
  }
}
