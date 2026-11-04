import { apiError, apiSuccess } from "@/lib/api";
import { verifyMaintenanceJobSecret } from "@/lib/maintenance-auth";
import { logServerEvent } from "@/lib/observability";
import { emailDeliveryEnabled, runEmailDeliveryWorker } from "@/modules/notifications/delivery";

const route = "/api/v1/internal/maintenance/notification-delivery";

export async function POST(request: Request) {
  const authorization = verifyMaintenanceJobSecret(request);
  if (!authorization.configured) return apiError("MAINTENANCE_NOT_CONFIGURED", "Scheduled notification delivery is not configured.", 503);
  if (!authorization.authorized) return apiError("UNAUTHORIZED", "Maintenance authorization failed.", 401);
  if (!emailDeliveryEnabled()) return apiError("EMAIL_DELIVERY_NOT_CONFIGURED", "Email delivery is disabled until verified provider credentials are configured.", 503);
  const startedAt = performance.now();
  try {
    const result = await runEmailDeliveryWorker();
    logServerEvent("info", "maintenance.notification_delivery_completed", { route, method: "POST", status: 200, durationMs: Math.round(performance.now() - startedAt), outcome: `processed:${result.processed};delivered:${result.delivered};failed:${result.failed}` });
    return apiSuccess(result);
  } catch (error) {
    logServerEvent("error", "maintenance.notification_delivery_failed", { route, method: "POST", status: 500, durationMs: Math.round(performance.now() - startedAt), errorType: error instanceof Error ? error.name : "UnknownError", outcome: "failed" });
    return apiError("NOTIFICATION_DELIVERY_RUN_FAILED", "Scheduled notification delivery failed safely.", 500);
  }
}
