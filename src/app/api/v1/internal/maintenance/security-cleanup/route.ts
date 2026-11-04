import { apiError, apiSuccess } from "@/lib/api";
import { verifyMaintenanceJobSecret } from "@/lib/maintenance-auth";
import { logServerEvent } from "@/lib/observability";
import { requestIdFromHeaders } from "@/lib/request-id";
import { runSecurityCleanup } from "@/modules/maintenance/security-cleanup";

export async function POST(request: Request) {
  const startedAt = performance.now();
  const requestId = requestIdFromHeaders(request.headers);
  const authorization = verifyMaintenanceJobSecret(request);
  if (!authorization.configured) {
    logServerEvent("error", "maintenance.security_cleanup_rejected", { requestId, route: "/api/v1/internal/maintenance/security-cleanup", method: "POST", status: 503, outcome: "not_configured" });
    return apiError("MAINTENANCE_NOT_CONFIGURED", "Scheduled maintenance is not configured.", 503);
  }
  if (!authorization.authorized) {
    logServerEvent("warn", "maintenance.security_cleanup_rejected", { requestId, route: "/api/v1/internal/maintenance/security-cleanup", method: "POST", status: 401, outcome: "unauthorized" });
    return apiError("UNAUTHORIZED", "Maintenance authorization failed.", 401);
  }
  try {
    const result = await runSecurityCleanup({ triggerSource: "SCHEDULER" });
    logServerEvent("info", "maintenance.security_cleanup_completed", { requestId, route: "/api/v1/internal/maintenance/security-cleanup", method: "POST", status: 200, durationMs: Math.round(performance.now() - startedAt), outcome: result.skipped ? "skipped" : "completed" });
    return apiSuccess({ runId: result.run.id, status: result.run.status, skipped: result.skipped, summary: result.run.summary });
  } catch (error) {
    logServerEvent("error", "maintenance.security_cleanup_failed", { requestId, route: "/api/v1/internal/maintenance/security-cleanup", method: "POST", status: 500, durationMs: Math.round(performance.now() - startedAt), errorType: error instanceof Error ? error.name : "UnknownError", outcome: "failed" });
    return apiError("MAINTENANCE_RUN_FAILED", "The maintenance run failed safely.", 500);
  }
}
