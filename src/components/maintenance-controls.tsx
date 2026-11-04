"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

type Configuration = { securityTokenRetentionDays: number; rateLimitRetentionHours: number; mfaEnrollmentRetentionHours: number; inventoryBatchSize: number };

export function MaintenanceControls({ configuration }: { configuration: Configuration }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"save" | "run" | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; setBusy("save"); setError(""); setMessage("");
    const response = await fetch("/api/v1/admin/maintenance/configuration", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    const result = await response.json(); setBusy(null);
    if (!response.ok) return setError(result.error?.message ?? "Unable to save maintenance settings.");
    setMessage("Cleanup settings saved and audited."); router.refresh();
  }
  async function run() {
    if (!window.confirm("Run protected cleanup now? Expired technical records will be removed according to the saved policy.")) return;
    setBusy("run"); setError(""); setMessage("");
    const response = await fetch("/api/v1/admin/maintenance/run", { method: "POST", headers: { "Content-Type": "application/json" } });
    const result = await response.json(); setBusy(null);
    if (!response.ok) return setError(result.error?.message ?? "Unable to run cleanup.");
    setMessage(result.data.skipped ? "Another cleanup is already running." : "Cleanup completed successfully."); router.refresh();
  }
  return <section className="maintenance-control-grid"><form onSubmit={save}><h2>Retention and batch limits</h2><p>These settings affect technical authentication artifacts only. Audit, order, wallet, payment, and customer history are never deleted by this job.</p><label>Used or expired security tokens<input name="securityTokenRetentionDays" type="number" min="1" max="365" defaultValue={configuration.securityTokenRetentionDays} required /><span>days before deletion</span></label><label>Inactive rate-limit counters<input name="rateLimitRetentionHours" type="number" min="1" max="720" defaultValue={configuration.rateLimitRetentionHours} required /><span>hours before deletion</span></label><label>Expired MFA enrollment attempts<input name="mfaEnrollmentRetentionHours" type="number" min="1" max="168" defaultValue={configuration.mfaEnrollmentRetentionHours} required /><span>hours before deletion</span></label><label>Inventory reservations per run<input name="inventoryBatchSize" type="number" min="1" max="500" defaultValue={configuration.inventoryBatchSize} required /><span>bounded database batch</span></label><button className="button primary" disabled={busy !== null} type="submit">{busy === "save" ? "Saving…" : "Save policy"}</button></form><aside><p className="eyebrow">MANUAL CONTROL</p><h2>Run a protected cleanup</h2><p>Expired secure-link payloads are wiped, stale counters and enrollment attempts are removed, and expired inventory is released. Overlapping runs are blocked automatically.</p><button className="button secondary" disabled={busy !== null} onClick={run} type="button">{busy === "run" ? "Running…" : "Run cleanup now"}</button><small>Production should invoke the protected scheduler endpoint automatically. Manual runs are for controlled operations and incident response.</small></aside>{error ? <p className="form-error" role="alert">{error}</p> : null}{message ? <p className="form-success" role="status">{message}</p> : null}</section>;
}
