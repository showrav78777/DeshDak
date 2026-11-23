"use client";
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useClientReady } from "./use-client-ready";
type Props = { kind: "request"; policySequence: number } | { kind: "decision"; requestId: string; expired: boolean };
export function PrivateMediaDeletionControls(props: Props) {
  const ready = useClientReady(), router = useRouter();
  const pending = useRef(false), retry = useRef<{ key: string; body: Record<string, unknown> } | null>(null);
  const [busy, setBusy] = useState(false), [locked, setLocked] = useState(false), [done, setDone] = useState(false), [error, setError] = useState("");
  const id = props.kind === "request" ? "deletion-request" : `deletion-${props.requestId}`;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!ready || pending.current || done) return;
    const form = new FormData(event.currentTarget);
    retry.current ??= { key: crypto.randomUUID(), body: { caseReference: form.get("caseReference"), confirmed: form.get("confirmed") === "on", ...(props.kind === "request" ? { uploadId: form.get("uploadId"), expectedPolicySequence: props.policySequence } : { decision: form.get("decision") }) } };
    pending.current = true; setBusy(true); setLocked(true); setError("");
    const path = props.kind === "request" ? "" : `/${encodeURIComponent(props.requestId)}/decision`;
    try {
      const response = await fetch(`/api/v1/admin/private-media/deletion-reviews${path}`, { method: "POST", credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(15000), headers: { "Content-Type": "application/json", "Idempotency-Key": retry.current.key }, body: JSON.stringify(retry.current.body) });
      const result = await response.json();
      if (!response.ok) { setError(result?.error?.message ?? "The review was not confirmed. Reload history before making another decision."); if (response.status === 422) { retry.current = null; setLocked(false); } return; }
      if (!/^[0-9a-f-]{36}$/i.test(result?.data?.id ?? "") || result.data.deletionEnabled !== false || props.kind === "decision" && result.data.decision !== retry.current.body.decision) throw new Error("Unconfirmed review");
      setDone(true); router.refresh();
    } catch { setError("The result could not be confirmed. Retry the same request or reload history before making another change."); }
    finally { pending.current = false; setBusy(false); }
  }
  if (done) return <p role="status">Review recorded. No files were deleted. <button type="button" className="button secondary" onClick={() => window.location.reload()}>Reload review history</button></p>;
  return <form onSubmit={submit} method="post" className="private-media-form">
    <noscript><p role="alert">Enable JavaScript to submit these protected reviews. Nothing has been submitted.</p></noscript>
    <fieldset disabled={!ready || busy || locked}><legend>{props.kind === "request" ? "Request an independent deletion review" : "Record an independent review decision"}</legend>
      {props.kind === "request" ? <><p>Policy version {props.policySequence}. The server must confirm the photo is ready for review. This creates a 24-hour review request, not an instruction to delete.</p><label htmlFor={`${id}-upload`}>Upload reference</label><input id={`${id}-upload`} name="uploadId" minLength={36} maxLength={36} required placeholder="Paste the upload UUID from the retention preview" /></> : <><label htmlFor={`${id}-decision`}>Decision</label><select id={`${id}-decision`} name="decision" defaultValue={props.expired ? "REJECTED" : "APPROVED"}><option value="APPROVED" disabled={props.expired}>Approve review — cleanup remains disabled</option><option value="REJECTED">Reject review</option></select><p>Approval requires unchanged policy/upload details and fresh eligibility checks. Reject stale or expired requests before creating a replacement.</p></>}
      <label htmlFor={`${id}-case`}>Controlled case reference</label><input id={`${id}-case`} name="caseReference" required minLength={8} maxLength={80} pattern="(INC|SEC|KYC|OPS)-[A-Z0-9]+(-[A-Z0-9]+){0,5}" placeholder="SEC-2026-001" /><p>Use an existing INC, SEC, KYC or OPS reference. No personal information, credentials or URLs.</p>
      <label className="private-photo-confirm"><input name="confirmed" type="checkbox" required />{props.kind === "request" ? "I reviewed the media context and retention requirements and request an independent decision." : "I independently checked applicable retention requirements and external/unrecorded investigations. This decision does not authorize file deletion."}</label>
    </fieldset>
    {error ? <p role="alert">{error}</p> : null}<button type="submit" className="button primary" disabled={!ready || busy}>{busy ? "Recording…" : props.kind === "request" ? "Request independent review" : "Record independent decision"}</button>
    {locked && error ? <button type="button" className="button secondary" disabled={busy} onClick={() => window.location.reload()}>Reload review history</button> : null}
  </form>;
}
