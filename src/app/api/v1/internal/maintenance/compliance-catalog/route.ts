import { apiError, apiSuccess } from "@/lib/api";
import { verifyMaintenanceJobSecret } from "@/lib/maintenance-auth";
import { logServerEvent } from "@/lib/observability";
import { requestIdFromHeaders } from "@/lib/request-id";
import { runComplianceCatalogMaintenance } from "@/modules/maintenance/compliance-catalog";

const route = "/api/v1/internal/maintenance/compliance-catalog";

export async function POST(request: Request) {
  const startedAt = performance.now();
  const requestId = requestIdFromHeaders(request.headers);
  const authorization = verifyMaintenanceJobSecret(request);
  if (!authorization.configured) {
    logServerEvent("error", "maintenance.compliance_catalog_rejected", { requestId, route, method: "POST", status: 503, outcome: "not_configured" });
    return apiError("MAINTENANCE_NOT_CONFIGURED", "Scheduled maintenance is not configured.", 503);
  }
  if (!authorization.authorized) {
    logServerEvent("warn", "maintenance.compliance_catalog_rejected", { requestId, route, method: "POST", status: 401, outcome: "unauthorized" });
    return apiError("UNAUTHORIZED", "Maintenance authorization failed.", 401);
  }
  try {
    const result = await runComplianceCatalogMaintenance({ triggerSource: "SCHEDULER" });
    logServerEvent("info", "maintenance.compliance_catalog_completed", { requestId, route, method: "POST", status: 200, durationMs: Math.round(performance.now() - startedAt), outcome: result.skipped ? "skipped" : "completed" });
    return apiSuccess({ runId: result.run.id, status: result.run.status, skipped: result.skipped, summary: result.run.summary });
  } catch (error) {
    logServerEvent("error", "maintenance.compliance_catalog_failed", { requestId, route, method: "POST", status: 500, durationMs: Math.round(performance.now() - startedAt), errorType: error instanceof Error ? error.name : "UnknownError", outcome: "failed" });
    return apiError("COMPLIANCE_MAINTENANCE_FAILED", "Catalog compliance maintenance failed safely.", 500);
  }
}
