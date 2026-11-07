"use client";
import { useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { useRouter } from "next/navigation";
const subscribe = () => () => {};
export function PrivatePhotoReview({ uploadId, sequence }: { uploadId: string; sequence: number }) {
  const ready = useSyncExternalStore(subscribe, () => true, () => false);
  const pending = useRef(false), key = useRef<string | null>(null);
  const payload = useRef<{ decision: FormDataEntryValue | null; caseReference: FormDataEntryValue | null; expectedSequence: number; blockedConfirmed: boolean } | null>(null);
  const [busy, setBusy] = useState(false), [locked, setLocked] = useState(false), [done, setDone] = useState(false), [error, setError] = useState("");
  const router = useRouter();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!ready || pending.current || done) return;
    const form = new FormData(event.currentTarget);
    pending.current = true; key.current ??= crypto.randomUUID();
    payload.current ??= { decision: form.get("decision"), caseReference: form.get("caseReference"), expectedSequence: sequence, blockedConfirmed: form.get("blockedConfirmed") === "on" };
    setBusy(true); setLocked(true); setError("");
    try {
      const response = await fetch(`/api/v1/admin/private-photos/${encodeURIComponent(uploadId)}/quarantine/reviews`, { method: "POST", credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(15_000), headers: { "Content-Type": "application/json", "Idempotency-Key": key.current }, body: JSON.stringify(payload.current) });
      const result = await response.json();
      if (!response.ok) { setError(result?.error?.message ?? "The review could not be confirmed. Reload the latest review before retrying."); return; }
      if (result?.data?.quarantined !== true || result?.data?.review?.sequence !== sequence + 1) throw new Error("Unconfirmed review");
      setDone(true); router.refresh();
    } catch { setError("The review could not be confirmed. Check the history or retry this same decision. The photo remains blocked."); }
    finally { pending.current = false; setBusy(false); }
  }
  if (done) return <p role="status">Review recorded. The photo remains quarantined.</p>;
  return <details className="private-photo-review"><summary>Record quarantine review</summary><form method="post" onSubmit={submit}>
    <p>Review {sequence + 1}. Record the next action from your controlled incident investigation. This records a decision only; it does not perform a rescan, request a file automatically or release the photo.</p>
    <noscript><p role="alert">Enable JavaScript to record a secure review. No decision has been recorded.</p></noscript>
    <label htmlFor={`decision-${uploadId}`}>Review decision</label><select id={`decision-${uploadId}`} name="decision" required disabled={busy || locked}><option value="">Choose the next action</option><option value="KEEP_BLOCKED">Keep blocked</option><option value="RESCAN_REQUIRED">Rescan required (not performed)</option><option value="REPLACEMENT_REQUIRED">Replacement photo required</option></select>
    <label htmlFor={`case-${uploadId}`}>Incident reference</label><input id={`case-${uploadId}`} name="caseReference" minLength={8} maxLength={80} pattern="(INC|SEC|KYC|OPS)-[A-Z0-9]+(-[A-Z0-9]+){0,5}" placeholder="INC-2026-001" required disabled={busy || locked} aria-describedby={`case-help-${uploadId}`} />
    <p id={`case-help-${uploadId}`}>Use an existing INC, SEC, KYC or OPS reference with uppercase letters, numbers and hyphens. Do not enter names, identity numbers, contact details, credentials or URLs.</p>
    <label className="private-photo-confirm"><input name="blockedConfirmed" type="checkbox" required disabled={busy || locked} /> I confirm this decision leaves the photo quarantined and does not certify a rescan or replacement.</label>
    {error ? <p role="alert">{error}</p> : null}<button className="button primary" type="submit" disabled={!ready || busy}>{busy ? "Recording review…" : "Record review"}</button>
  </form></details>;
}
