import { apiError, apiSuccess } from "@/lib/api";
import { type NextRequest } from "next/server";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { runScheduledMarketingCampaigns } from "@/modules/notifications/scheduled-campaigns";

export async function POST(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN)) return apiError("ADMIN_ACCESS_REQUIRED", "Administrator access is required.", 403);
  try {
    const result = await runScheduledMarketingCampaigns({ triggerSource: "ADMIN", triggeredById: session.userId });
    return apiSuccess({ runId: result.run.id, status: result.run.status, skipped: result.skipped, summary: result.summary });
  } catch {
    return apiError("CAMPAIGN_DELIVERY_RUN_FAILED", "Due campaigns could not be processed safely. Review the campaign history and retry.", 500);
  }
}
