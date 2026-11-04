"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { launchReadinessCategories, launchReadinessStatuses } from "@/modules/launch-readiness/schemas";

type LaunchItem = {
  id: string;
  category: string;
  title: string;
  requirement: string;
  status: string;
  isRequired: boolean;
  isBaseline: boolean;
  ownerName: string | null;
  dueAt: string | null;
  evidenceReference: string | null;
  evidenceNote: string | null;
  blockerReason: string | null;
  version: number;
  verifiedAt: string | null;
  updatedAt: string;
  updatedBy: { fullName: string; personCode: string } | null;
  verifiedBy: { fullName: string; personCode: string } | null;
  events: Array<{
    id: string;
    fromStatus: string | null;
    toStatus: string;
    itemVersion: number;
    ownerNameSnapshot: string | null;
    dueAtSnapshot: string | null;
    evidenceReferenceSnapshot: string | null;
    evidenceNoteSnapshot: string | null;
    blockerReasonSnapshot: string | null;
    occurredAt: string;
    actor: { fullName: string; personCode: string } | null;
  }>;
};

const label = (value: string) => value.replaceAll("_", " ").toLowerCase().replace(/^./, (character) => character.toUpperCase());
const dateValue = (value: string | null) => value ? new Date(value).toISOString().slice(0, 10) : "";
const errorMessage = (result: unknown, fallback: string) => (result as { error?: { message?: string } })?.error?.message ?? fallback;

export function LaunchReadinessCreateForm() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError("");
    const form = event.currentTarget; const values = new FormData(form);
    const response = await fetch("/api/v1/admin/launch-readiness", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category: values.get("category"), title: values.get("title"), requirement: values.get("requirement"), ownerName: values.get("ownerName"), dueAt: values.get("dueAt") || null, isRequired: values.get("isRequired") === "on" }) });
    const result = await response.json(); setSaving(false);
    if (!response.ok) return setError(errorMessage(result, "Could not add this requirement."));
    form.reset(); router.refresh();
  }
  return <form className="launch-readiness-create" onSubmit={submit}><h2>Add an operational requirement</h2><p>Use this for a real launch dependency that is not already in the baseline. Never enter passwords, tokens, API keys, or private credentials.</p><label>Category<select name="category" defaultValue="OTHER">{launchReadinessCategories.map((category) => <option key={category} value={category}>{label(category)}</option>)}</select></label><label>Requirement title<input name="title" minLength={3} maxLength={120} required /></label><label className="wide">Acceptance requirement<textarea name="requirement" minLength={10} maxLength={1500} required /></label><label>Responsible owner<input name="ownerName" maxLength={120} /></label><label>Target date<input name="dueAt" type="date" /></label><label className="check wide"><input name="isRequired" type="checkbox" defaultChecked /> Required before paid launch</label>{error ? <p className="form-error wide" role="alert">{error}</p> : null}<button className="button primary" disabled={saving} type="submit">{saving ? "Adding…" : "Add requirement"}</button></form>;
}

export function LaunchReadinessItemForm({ item }: { item: LaunchItem }) {
  const router = useRouter(); const [saving, setSaving] = useState(false); const [error, setError] = useState(""); const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(""); setMessage("");
    const values = new FormData(event.currentTarget);
    const response = await fetch(`/api/v1/admin/launch-readiness/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category: values.get("category"), title: values.get("title"), requirement: values.get("requirement"), status: values.get("status"), isRequired: values.get("isRequired") === "on", ownerName: values.get("ownerName"), dueAt: values.get("dueAt") || null, evidenceReference: values.get("evidenceReference"), evidenceNote: values.get("evidenceNote"), blockerReason: values.get("blockerReason"), version: item.version, verificationConfirmed: values.get("verificationConfirmed") === "on" }) });
    const result = await response.json(); setSaving(false);
    if (!response.ok) return setError(errorMessage(result, "Could not save this launch requirement."));
    setMessage("Launch evidence saved and audited."); router.refresh();
  }
  return <form className={`launch-readiness-item status-${item.status.toLowerCase()}`} onSubmit={submit}><header><div><span>{label(item.category)} · {item.isBaseline ? "Baseline gate" : "Custom gate"}</span><h2>{item.title}</h2></div><b>{label(item.status)}</b></header><div className="launch-readiness-fields"><label>Category<select name="category" defaultValue={item.category}>{launchReadinessCategories.map((category) => <option key={category} value={category}>{label(category)}</option>)}</select></label><label>Status<select name="status" defaultValue={item.status}>{launchReadinessStatuses.map((status) => <option key={status} value={status}>{label(status)}</option>)}</select></label><label>Responsible owner<input name="ownerName" maxLength={120} defaultValue={item.ownerName ?? ""} /></label><label>Target date<input name="dueAt" type="date" defaultValue={dateValue(item.dueAt)} /></label><label className="wide">Title<input name="title" minLength={3} maxLength={120} defaultValue={item.title} required /></label><label className="wide">Acceptance requirement<textarea name="requirement" minLength={10} maxLength={1500} defaultValue={item.requirement} required /></label><label className="wide">Evidence reference<input name="evidenceReference" maxLength={500} defaultValue={item.evidenceReference ?? ""} placeholder="Approved ticket, report, contract or HTTPS evidence location — never a secret" /></label><label className="wide">Evidence review note<textarea name="evidenceNote" maxLength={2000} defaultValue={item.evidenceNote ?? ""} /></label><label className="wide">Current blocker reason<textarea name="blockerReason" maxLength={1000} defaultValue={item.blockerReason ?? ""} /></label><label className="check"><input name="isRequired" type="checkbox" defaultChecked={item.isRequired} /> Required before paid launch</label><label className="check"><input name="verificationConfirmed" type="checkbox" /> I reviewed the evidence before marking Verified</label></div><footer><div><small>Version {item.version} · updated {new Date(item.updatedAt).toLocaleString()}</small>{item.updatedBy ? <small>by {item.updatedBy.fullName} · {item.updatedBy.personCode}</small> : <small>System baseline</small>}{item.verifiedAt && item.verifiedBy ? <small>Verified {new Date(item.verifiedAt).toLocaleString()} by {item.verifiedBy.fullName}</small> : null}</div><button className="button secondary" disabled={saving} type="submit">{saving ? "Saving…" : "Save evidence"}</button></footer><details className="launch-readiness-history"><summary>Immutable decision history ({item.events.length})</summary><ol>{item.events.map((event) => <li key={event.id}><div><b>v{event.itemVersion} · {event.fromStatus ? `${label(event.fromStatus)} → ` : "Created as "}{label(event.toStatus)}</b><small>{new Date(event.occurredAt).toLocaleString()} · {event.actor ? `${event.actor.fullName} · ${event.actor.personCode}` : "System baseline"}</small></div>{event.ownerNameSnapshot ? <span>Owner: {event.ownerNameSnapshot}</span> : null}{event.dueAtSnapshot ? <span>Due: {new Date(event.dueAtSnapshot).toLocaleDateString()}</span> : null}{event.evidenceReferenceSnapshot ? <span>Evidence: {event.evidenceReferenceSnapshot}</span> : null}{event.evidenceNoteSnapshot ? <p>{event.evidenceNoteSnapshot}</p> : null}{event.blockerReasonSnapshot ? <p className="history-blocker">Blocker: {event.blockerReasonSnapshot}</p> : null}</li>)}</ol></details>{error ? <p className="form-error" role="alert">{error}</p> : null}{message ? <p className="form-success" role="status">{message}</p> : null}</form>;
}
