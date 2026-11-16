"use client";

import { useClientReady } from "@/components/use-client-ready";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type FormEvent } from "react";

type Configuration = { securityTokenRetentionDays: number; rateLimitRetentionHours: number; mfaEnrollmentRetentionHours: number; inventoryBatchSize: number };

export function MaintenanceControls({ configuration }: { configuration: Configuration }) {
  const router = useRouter();
  const ready = useClientReady(), inFlight = useRef(false);
  const [refreshing, startRefresh] = useTransition();
  const [busy, setBusy] = useState<"save" | "run" | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || inFlight.current || busy || refreshing) return;
    inFlight.current = true; const form = event.currentTarget; setBusy("save"); setError(""); setMessage("");
    try {
      const expected = Object.fromEntries(new FormData(form));
      const response = await fetch("/api/v1/admin/maintenance/configuration", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(expected), signal: AbortSignal.timeout(30_000) });
      const result = await response.json();
      if (!response.ok) { setError(result.error?.message ?? "Unable to save maintenance settings."); return; }
      if (!result?.data?.configuration || !["securityTokenRetentionDays", "rateLimitRetentionHours", "mfaEnrollmentRetentionHours", "inventoryBatchSize"].every(key => Number.isSafeInteger(result.data.configuration[key]) && result.data.configuration[key] > 0 && result.data.configuration[key] === Number(expected[key]))) throw new Error("Invalid maintenance response");
      setMessage("Cleanup settings saved and audited."); startRefresh(() => router.refresh());
    } catch { setError("The settings request could not be confirmed. Reload the saved policy before retrying."); }
    finally { inFlight.current = false; setBusy(null); }
  }
  async function run() {
    if (!ready || inFlight.current || busy || refreshing) return;
    if (!window.confirm("Run protected cleanup now? Expired technical records will be removed according to the saved policy.")) return;
    inFlight.current = true; setBusy("run"); setError(""); setMessage("");
    try {
      const response = await fetch("/api/v1/admin/maintenance/run", { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(45_000) });
      const result = await response.json();
      if (!response.ok) { setError(result.error?.message ?? "Unable to run cleanup."); return; }
      if (!result?.data || typeof result.data.skipped !== "boolean" || typeof result.data.runId !== "string" || !result.data.runId || result.data.status !== (result.data.skipped ? "SKIPPED" : "SUCCEEDED")) throw new Error("Invalid maintenance response");
      setMessage(result.data.skipped ? "Another cleanup is already running." : "Cleanup completed successfully."); startRefresh(() => router.refresh());
    } catch { setError("The cleanup request could not be confirmed. Check recent run history before retrying."); }
    finally { inFlight.current = false; setBusy(null); }
  }
  return <section className="maintenance-control-grid"><form onSubmit={save}><h2>Retention and batch limits</h2><p>These settings affect technical authentication artifacts only. Audit, order, wallet, payment, and customer history are never deleted by this job.</p><label>Used or expired security tokens<input disabled={!ready || busy !== null || refreshing} name="securityTokenRetentionDays" type="number" min="1" max="365" defaultValue={configuration.securityTokenRetentionDays} required /><span>days before deletion</span></label><label>Inactive rate-limit counters<input disabled={!ready || busy !== null || refreshing} name="rateLimitRetentionHours" type="number" min="1" max="720" defaultValue={configuration.rateLimitRetentionHours} required /><span>hours before deletion</span></label><label>Expired MFA enrollment attempts<input disabled={!ready || busy !== null || refreshing} name="mfaEnrollmentRetentionHours" type="number" min="1" max="168" defaultValue={configuration.mfaEnrollmentRetentionHours} required /><span>hours before deletion</span></label><label>Inventory reservations per run<input disabled={!ready || busy !== null || refreshing} name="inventoryBatchSize" type="number" min="1" max="500" defaultValue={configuration.inventoryBatchSize} required /><span>bounded database batch</span></label><button className="button primary" disabled={!ready || busy !== null || refreshing} type="submit">{busy === "save" ? "Saving…" : "Save policy"}</button></form><aside><p className="eyebrow">MANUAL CONTROL</p><h2>Run a protected cleanup</h2><p>Expired or invalidated unattempted SMS verification payloads and expired secure-link payloads are wiped. Attempted SMS evidence is preserved. Stale counters and enrollment attempts are removed, and expired inventory is released. Overlapping runs are blocked automatically.</p><button className="button secondary" disabled={!ready || busy !== null || refreshing} onClick={run} type="button">{busy === "run" ? "Running…" : "Run cleanup now"}</button><small>Production should invoke the protected scheduler endpoint automatically. Manual runs are for controlled operations and incident response.</small></aside>{error ? <p className="form-error" role="alert">{error}</p> : null}{message ? <p className="form-success" role="status">{message}</p> : null}</section>;
}
