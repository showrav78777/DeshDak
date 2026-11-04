import { apiError, apiSuccess } from "@/lib/api";
import { verifyMaintenanceJobSecret } from "@/lib/maintenance-auth";
import { runPaymentOperationsMonitor } from "@/modules/maintenance/payment-operations";

export async function POST(request: Request) {
  const authorization = verifyMaintenanceJobSecret(request);
  if (!authorization.configured) return apiError("MAINTENANCE_NOT_CONFIGURED", "Payment monitoring is not configured.", 503);
  if (!authorization.authorized) return apiError("UNAUTHORIZED", "Maintenance authorization failed.", 401);
  try { const result = await runPaymentOperationsMonitor({ triggerSource: "SCHEDULER" }); return apiSuccess({ runId: result.run.id, status: result.run.status, skipped: result.skipped, summary: result.run.summary }); }
  catch { return apiError("PAYMENT_OPERATIONS_MONITOR_FAILED", "Payment monitoring failed safely.", 500); }
}
