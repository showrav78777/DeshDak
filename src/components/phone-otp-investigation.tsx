"use client";
import { useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { useRouter } from "next/navigation";
const subscribe = () => () => {};
export function PhoneOtpInvestigation({ id }: { id: string }) {
  const ready = useSyncExternalStore(subscribe, () => true, () => false);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const router = useRouter();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!ready || pending.current) return;
    pending.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/v1/admin/notifications/sms/${encodeURIComponent(id)}/investigation`, { method: "POST", credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(15_000), headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reviewed: true }) });
      const result = await response.json();
      if (!response.ok) { setError(result?.error?.message ?? "Acknowledgement could not be confirmed. Reload before retrying."); return; }
      if (result?.data?.acknowledged !== true) throw new Error("Unconfirmed acknowledgement");
      setMessage("Investigation acknowledged. Sending and delivery status are unchanged."); router.refresh();
    } catch { setError("Acknowledgement could not be confirmed. Check the current job before retrying."); }
    finally { pending.current = false; setBusy(false); }
  }
  return <form className="sms-otp-review" onSubmit={submit} method="post"><noscript><p>Enable JavaScript to record an acknowledgement. No change has been made.</p></noscript><label><input type="checkbox" required /> I reviewed the available references and will follow up on missing evidence.</label><p>This records an investigation only. It does not resolve delivery or permit a resend.</p>{error ? <p role="alert" className="form-error">{error}</p> : null}{message ? <p role="status" className="form-success">{message}</p> : null}<button className="button secondary" type="submit" disabled={!ready || busy}>{busy ? "Recording…" : "Acknowledge investigation"}</button></form>;
}
