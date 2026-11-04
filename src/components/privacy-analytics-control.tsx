"use client";

import { useRef, useState } from "react";
import { useClientReady } from "@/components/use-client-ready";

export function PrivacyAnalyticsControl({ enabled, recordedAt }: { enabled: boolean; recordedAt: string | null }) {
  const ready = useClientReady();
  const pending = useRef(false);
  const [allowed, setAllowed] = useState(enabled);
  const [savedAt, setSavedAt] = useState(recordedAt);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function update(next: boolean) {
    if (!ready || pending.current) return;
    pending.current = true; setSaving(true); setMessage(""); setError("");
    try {
      const response = await fetch("/api/v1/users/me/privacy", { method: "PATCH", credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(15_000), headers: { "Content-Type": "application/json" }, body: JSON.stringify({ analyticsConsent: next }) });
      const result = await response.json();
      const privacy = result?.data?.privacy;
      if (!response.ok || privacy?.analyticsConsent !== next || (privacy.analyticsConsentAt !== null && (typeof privacy.analyticsConsentAt !== "string" || !Number.isFinite(Date.parse(privacy.analyticsConsentAt))))) throw new Error("Unconfirmed privacy choice");
      setAllowed(privacy.analyticsConsent); setSavedAt(privacy.analyticsConsentAt); setMessage("Privacy setting saved.");
    } catch {
      setError("Could not confirm your choice. Reload to check the saved setting, then try again.");
    } finally { pending.current = false; setSaving(false); }
  }
  return <section className="privacy-control"><div><p className="eyebrow">PRIVACY CONTROL</p><h2>Optional shopping analytics</h2><p>Allow DeshDak to record product views and catalog activity to improve recommendations. Security, order, payment, and support records are retained separately because they are required to operate and protect your account.</p>{savedAt ? <small>Last choice recorded {new Date(savedAt).toLocaleString("en-GB", { timeZone: "UTC" })} UTC</small> : <small>No optional analytics consent recorded.</small>}</div><label><input aria-label="Allow optional shopping analytics" type="checkbox" checked={allowed} disabled={!ready || saving} onChange={(event) => update(event.target.checked)} /><span>{saving ? "Saving…" : allowed ? "Allowed" : "Off"}</span></label>{!ready ? <p>Enable JavaScript to update this setting. No change has been submitted.</p> : null}{error ? <p className="form-error" role="alert">{error}</p> : null}{message ? <p role="status">{message}</p> : null}</section>;
}
