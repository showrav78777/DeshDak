"use client";
import { useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { useRouter } from "next/navigation";

const subscribe = () => () => {};
export function EmailSuppressionRelease({ id, version }: { id: string; version: number }) {
  const ready = useSyncExternalStore(subscribe, () => true, () => false);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const router = useRouter();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || pending.current) return;
    const data = new FormData(event.currentTarget);
    pending.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/v1/admin/email-suppressions/${encodeURIComponent(id)}/release`, {
        method: "POST", credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(15_000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version, reason: data.get("reason"), evidenceReference: data.get("evidenceReference"), verificationConfirmed: data.get("verificationConfirmed") === "on" }),
      });
      const result = await response.json();
      if (!response.ok) { setError(result?.error?.message ?? "Review could not be confirmed. Reload the current record before retrying."); return; }
      if (result?.data?.released !== true) throw new Error("Unconfirmed review");
      setMessage("Released for future approved emails. Existing failed messages were not resent.");
      router.refresh();
    } catch { setError("Review could not be confirmed. Check your connection and the current record before retrying the same review."); }
    finally { pending.current = false; setBusy(false); }
  }
  return <details className="email-suppression-review"><summary>Review and release this address</summary>
    <p>Confirm the recipient correction or consent and review the provider suppression first. Release permits future approved emails; it never resends existing failed messages.</p>
    <form method="post" onSubmit={submit}>
      <noscript><p role="alert">Enable JavaScript to submit a secure review. No change has been made.</p></noscript>
      <label htmlFor={`reason-${id}`}>Review reason</label><textarea id={`reason-${id}`} name="reason" minLength={10} maxLength={500} required />
      <label htmlFor={`evidence-${id}`}>Safe evidence reference</label><input id={`evidence-${id}`} name="evidenceReference" minLength={10} maxLength={500} required placeholder="Internal review or support reference; no credentials" />
      <label className="email-suppression-confirm"><input type="checkbox" name="verificationConfirmed" required /> I verified the recipient correction or consent and reviewed the provider suppression.</label>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {message ? <p className="form-success" role="status">{message}</p> : null}
      <button className="button primary" type="submit" disabled={!ready || busy}>{busy ? "Recording review…" : "Record verified release"}</button>
    </form>
  </details>;
}
