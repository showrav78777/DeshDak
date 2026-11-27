"use client";
import { useRef, useState, useSyncExternalStore, type FormEvent } from "react";
const subscribe = () => () => {};

export function PrivateVideoQuarantine({ jobId }: { jobId: string }) {
  const ready = useSyncExternalStore(subscribe, () => true, () => false), pending = useRef(false);
  const key = useRef<string | null>(null), payload = useRef<{ reason: string; caseReference: string; confirmed: boolean } | null>(null);
  const [busy, setBusy] = useState(false), [locked, setLocked] = useState(false), [done, setDone] = useState(false), [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!ready || pending.current || done) return;
    const form = new FormData(event.currentTarget);
    pending.current = true; setBusy(true); setError(""); key.current ??= crypto.randomUUID();
    payload.current ??= { reason: String(form.get("reason") ?? ""), caseReference: String(form.get("caseReference") ?? ""), confirmed: form.get("confirmed") === "on" }; setLocked(true);
    try {
      const response = await fetch(`/api/v1/admin/private-videos/${encodeURIComponent(jobId)}/quarantine`, { method: "POST", credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(15000), headers: { "Content-Type": "application/json", "Idempotency-Key": key.current }, body: JSON.stringify(payload.current) });
      const result = await response.json();
      if (!response.ok) { setError(result?.error?.message ?? "The block could not be confirmed."); return; }
      if (result?.data?.quarantined !== true || result.data.jobId !== jobId) throw new Error("Unconfirmed block");
      setDone(true);
    } catch { setError("The block could not be confirmed. Retry the same request or reload the queue to reconcile it; do not assume it failed."); }
    finally { pending.current = false; setBusy(false); }
  }
  if (done) return <p role="status">Quarantined. Preview, binding and ordinary recovery are blocked. Reload the queue to see the recorded reason.</p>;
  return <details><summary>Quarantine this video bundle</summary><form className="private-photo-review" onSubmit={submit} method="post">
    <p>This permanent block preserves the original, video, thumbnail and history. A separate replacement review is required; this screen cannot release or delete the bundle.</p>
    <noscript><p role="alert">Enable JavaScript to record a secure block. No change has been made.</p></noscript>
    <label htmlFor={`video-reason-${jobId}`}>Reason</label><select id={`video-reason-${jobId}`} name="reason" required disabled={busy || locked}><option value="">Choose a reason</option><option value="SUSPECTED_MALWARE">Suspected malware</option><option value="PRIVACY_REVIEW">Privacy review</option><option value="INTEGRITY_FAILURE">Integrity failure</option></select>
    <label htmlFor={`video-case-${jobId}`}>Case reference</label><input id={`video-case-${jobId}`} name="caseReference" placeholder="SEC-REVIEW-12345" minLength={8} maxLength={80} pattern="(INC|SEC|KYC|OPS)-[A-Z0-9]+(-[A-Z0-9]+){0,5}" required disabled={busy || locked} />
    <label className="private-photo-confirm"><input type="checkbox" name="confirmed" required disabled={busy || locked} /> I checked this bundle and confirm permanent quarantine for the recorded case.</label>
    {error ? <p role="alert">{error}</p> : null}<button className="button primary" type="submit" disabled={!ready || busy}>{busy ? "Recording quarantine…" : "Confirm video quarantine"}</button>
  </form></details>;
}
