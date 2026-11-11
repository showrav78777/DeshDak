"use client";
import { useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { useRouter } from "next/navigation";
const subscribe = () => () => {};
export function PrivatePhotoRescan({ uploadId, sequence }: { uploadId: string; sequence: number }) {
  const ready = useSyncExternalStore(subscribe, () => true, () => false), pending = useRef(false), key = useRef<string | null>(null);
  const [busy, setBusy] = useState(false), [locked, setLocked] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState(""); const router = useRouter();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!ready || pending.current || message) return;
    pending.current = true; key.current ??= crypto.randomUUID(); setBusy(true); setLocked(true); setError("");
    try {
      const response = await fetch(`/api/v1/admin/private-photos/${encodeURIComponent(uploadId)}/quarantine/rescans`, { method: "POST", credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(45_000), headers: { "Content-Type": "application/json", "Idempotency-Key": key.current }, body: JSON.stringify({ expectedSequence: sequence, blockedConfirmed: true }) });
      const result = await response.json();
      if (!response.ok) { setError(result?.error?.message ?? "Rescan could not be confirmed. Check its history before retrying."); return; }
      if (!result?.data?.id || result.data.quarantined !== true || !["CLEAN", "UNCONFIRMED", "PENDING", "EXPIRED"].includes(result.data.state)) throw new Error("Unconfirmed rescan");
      setMessage(result.data.state === "CLEAN" ? "The stored copy passed this scan. The original upload was not rescanned. Quarantine remains in place." : "No clean proof is available. Check the attempt in history; quarantine remains in place."); router.refresh();
    } catch { setError("The rescan outcome is uncertain. Retry the same request or reload history; do not start another attempt. The photo remains blocked."); }
    finally { pending.current = false; setBusy(false); }
  }
  return <form method="post" onSubmit={submit} className="private-photo-rescan">
    <p>Verify and scan the exact normalized copy stored for review #{sequence}. No file bytes are shown or downloaded. A clean result never releases quarantine.</p>
    <noscript><p role="alert">Enable JavaScript to request a secure scan. No rescan has started.</p></noscript>
    <label className="private-photo-confirm"><input type="checkbox" required disabled={busy || locked} /> I authorize processing this copy with the approved private scanner and confirm the photo stays quarantined.</label>
    {error ? <p role="alert">{error}</p> : null}{message ? <p role="status">{message}</p> : null}
    <button className="button primary" type="submit" disabled={!ready || busy || Boolean(message)}>{busy ? "Verifying stored copy…" : "Scan stored copy"}</button>
  </form>;
}
