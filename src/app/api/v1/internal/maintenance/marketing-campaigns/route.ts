import { apiError, apiSuccess } from "@/lib/api";
import { verifyMaintenanceJobSecret } from "@/lib/maintenance-auth";
import { runScheduledMarketingCampaigns } from "@/modules/notifications/scheduled-campaigns";

export async function POST(request: Request) {
  const authorization = verifyMaintenanceJobSecret(request);
  if (!authorization.configured) return apiError("MAINTENANCE_NOT_CONFIGURED", "Scheduled campaign delivery is not configured.", 503);
  if (!authorization.authorized) return apiError("UNAUTHORIZED", "Maintenance authorization failed.", 401);
  try {
    const result = await runScheduledMarketingCampaigns({ triggerSource: "SCHEDULER" });
    return apiSuccess({ runId: result.run.id, status: result.run.status, skipped: result.skipped, summary: result.summary });
  } catch {
    return apiError("CAMPAIGN_DELIVERY_RUN_FAILED", "Scheduled campaign delivery failed safely.", 500);
  }
}
