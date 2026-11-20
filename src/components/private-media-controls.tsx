"use client";
import { useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { useRouter } from "next/navigation";
const subscribe = () => () => {};
type Props = { kind: "policy"; sequence: number; values: { identityDays: number; inspectionDays: number; abandonedHours: number } } | { kind: "hold" } | { kind: "release"; holdId: string };
export function PrivateMediaControls(props: Props) {
  const ready = useSyncExternalStore(subscribe, () => true, () => false);
  const pending = useRef(false), retry = useRef<{ key: string; body: Record<string, unknown> } | null>(null);
  const [busy, setBusy] = useState(false), [locked, setLocked] = useState(false), [done, setDone] = useState(false), [error, setError] = useState("");
  const router = useRouter();
  const id = props.kind === "release" ? `release-${props.holdId}` : `media-${props.kind}`;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!ready || pending.current || done) return;
    const form = new FormData(event.currentTarget);
    retry.current ??= { key: crypto.randomUUID(), body: { caseReference: form.get("caseReference"), confirmed: form.get("confirmed") === "on", ...(props.kind === "policy" ? { expectedSequence: props.sequence, identityDays: Number(form.get("identityDays")), inspectionDays: Number(form.get("inspectionDays")), abandonedHours: Number(form.get("abandonedHours")) } : props.kind === "hold" ? { scope: form.get("scope"), targetId: form.get("targetId") } : {}) } };
    pending.current = true; setBusy(true); setLocked(true); setError("");
    const path = props.kind === "policy" ? "policy" : props.kind === "hold" ? "holds" : `holds/${encodeURIComponent(props.holdId)}/release`;
    try {
      const response = await fetch(`/api/v1/admin/private-media/${path}`, { method: "POST", credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(15000), headers: { "Content-Type": "application/json", "Idempotency-Key": retry.current.key }, body: JSON.stringify(retry.current.body) });
      const result = await response.json();
      if (!response.ok) { setError(result?.error?.message ?? "The change was not confirmed. Check current history before retrying."); if (response.status === 422) { retry.current = null; setLocked(false); } return; }
      if (props.kind === "policy" ? result?.data?.sequence !== props.sequence + 1 || result?.data?.deletionEnabled !== false : props.kind === "release" ? result?.data?.released !== true : typeof result?.data?.id !== "string") throw new Error("Unconfirmed change");
      setDone(true); router.refresh();
    } catch { setError("The result could not be confirmed. Retry the same request or reload history before making another change."); }
    finally { pending.current = false; setBusy(false); }
  }
  if (done) return <p role="status">Recorded. Automatic deletion remains disabled. <button type="button" className="button secondary" onClick={() => window.location.reload()}>Reload current history</button></p>;
  return <form onSubmit={submit} method="post" className="private-media-form">
    <noscript><p role="alert">Enable JavaScript to use these protected controls. Nothing has been submitted.</p></noscript>
    <fieldset disabled={!ready || busy || locked}>
      {props.kind === "policy" ? <><legend>Record policy version {props.sequence + 1}</legend><label htmlFor={`${id}-identity`}>Identity photos: days after final review</label><input id={`${id}-identity`} name="identityDays" type="number" min={1} max={36500} step={1} required defaultValue={props.values.identityDays} /><label htmlFor={`${id}-inspection`}>Inspection evidence: days after delivery and case closure</label><input id={`${id}-inspection`} name="inspectionDays" type="number" min={1} max={36500} step={1} required defaultValue={props.values.inspectionDays} /><label htmlFor={`${id}-abandoned`}>Abandoned uploads: hours before review eligibility</label><input id={`${id}-abandoned`} name="abandonedHours" type="number" min={24} max={8760} step={1} required defaultValue={props.values.abandonedHours} /><p>These settings record review eligibility only. They do not establish legal retention requirements or enable deletion.</p></> : props.kind === "hold" ? <><legend>Place a preservation hold</legend><label htmlFor={`${id}-scope`}>Preserve media for</label><select id={`${id}-scope`} name="scope" required defaultValue="UPLOAD"><option value="UPLOAD">One upload</option><option value="ACCOUNT">Customer account, including later linked photos</option><option value="ORDER">An order, including later linked photos</option><option value="PACKAGE">A package, including later linked photos</option></select><label htmlFor={`${id}-target`}>Record reference</label><input id={`${id}-target`} name="targetId" required minLength={36} maxLength={36} placeholder="Copy the UUID reference from the related Admin record" /><p>Use the upload reference from Private photo safety or the account/order/package reference from its Admin record. Do not enter a name, document number or tracking code.</p></> : <legend>Independently release this hold</legend>}
      <label htmlFor={`${id}-case`}>Controlled case reference</label><input id={`${id}-case`} name="caseReference" minLength={8} maxLength={80} pattern="(INC|SEC|KYC|OPS)-[A-Z0-9]+(-[A-Z0-9]+){0,5}" placeholder="SEC-2026-001" required aria-describedby={`${id}-help`} /><p id={`${id}-help`}>Use an existing INC, SEC, KYC or OPS reference. No personal details, credentials or URLs.</p>
      <label className="private-photo-confirm"><input name="confirmed" type="checkbox" required />{props.kind === "policy" ? "I checked the policy with Compliance. This records a version without enabling deletion." : props.kind === "hold" ? "I confirm the case requires preserving this media." : "I independently reviewed the case and may release this hold. Other holds and retention requirements remain in force."}</label>
    </fieldset>
    {error ? <p role="alert">{error}</p> : null}<button className="button primary" type="submit" disabled={!ready || busy}>{busy ? "Recording…" : props.kind === "policy" ? "Record policy version" : props.kind === "hold" ? "Place hold" : "Release this hold"}</button>
    {locked && error ? <button type="button" className="button secondary" disabled={busy} onClick={() => window.location.reload()}>Reload current history</button> : null}
  </form>;
}
