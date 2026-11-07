"use client";
import { useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { useRouter } from "next/navigation";
const subscribe = () => () => {};
export function PrivatePhotoQuarantine({ uploadId }: { uploadId: string }) {
  const ready = useSyncExternalStore(subscribe, () => true, () => false);
  const pending = useRef(false), key = useRef<string | null>(null), payload = useRef<{ reason: FormDataEntryValue | null; confirmed: boolean } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [done, setDone] = useState(false), [locked, setLocked] = useState(false);
  const router = useRouter();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!ready || pending.current || done) return;
    const form = new FormData(event.currentTarget);
    pending.current = true; setBusy(true); setError(""); key.current ??= crypto.randomUUID();
    payload.current ??= { reason: form.get("reason"), confirmed: form.get("confirmed") === "on" }; setLocked(true);
    try {
      const response = await fetch(`/api/v1/admin/private-photos/${encodeURIComponent(uploadId)}/quarantine`, { method: "POST", credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(15_000), headers: { "Content-Type": "application/json", "Idempotency-Key": key.current }, body: JSON.stringify(payload.current) });
      const result = await response.json();
      if (!response.ok) { setError(result?.error?.message ?? "The block could not be confirmed."); return; }
      if (result?.data?.quarantined !== true) throw new Error("Unconfirmed quarantine");
      setDone(true); router.refresh();
    } catch { setError("The block could not be confirmed. Check the queue and retry the same reason; do not assume it failed."); }
    finally { pending.current = false; setBusy(false); }
  }
  if (done) return <p role="status">Quarantined. Downloads and ordinary upload recovery are blocked.</p>;
  return <details><summary>Quarantine this photo</summary><form onSubmit={submit} method="post">
    <p>This block cannot be released from this screen. It preserves the file and history. Confirm the upload reference before continuing.</p>
    <noscript><p role="alert">Enable JavaScript to record a secure quarantine. No change has been made.</p></noscript>
    <label htmlFor={`reason-${uploadId}`}>Reason</label><select id={`reason-${uploadId}`} name="reason" required disabled={busy || locked}><option value="">Choose a reason</option><option value="SUSPECTED_MALWARE">Suspected malware</option><option value="PRIVACY_REVIEW">Privacy review</option><option value="INTEGRITY_FAILURE">File integrity failure</option></select>
    <label className="private-photo-confirm"><input type="checkbox" name="confirmed" required disabled={busy || locked} /> I checked this upload reference and confirm a permanent quarantine pending a separate controlled review.</label>
    {error ? <p role="alert">{error}</p> : null}<button className="button primary" type="submit" disabled={!ready || busy}>{busy ? "Recording quarantine…" : "Confirm quarantine"}</button>
  </form></details>;
}
