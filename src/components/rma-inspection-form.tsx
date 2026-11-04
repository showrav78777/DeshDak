"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function RmaInspectionForm({ rmaId, version }: { rmaId: string; version: number }) {
  const router = useRouter(); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setSaving(true); setError(""); const values = Object.fromEntries(new FormData(event.currentTarget)); const evidence = String(values.evidenceReference ?? "").trim(); const response = await fetch(`/api/v1/operations/rmas/${rmaId}/inspect`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ result: values.result, notes: values.notes, evidenceReferences: evidence ? [evidence] : [], version }) }); const result = await response.json(); setSaving(false); if (!response.ok) return setError(result.error?.message ?? "Could not complete this inspection."); router.push("/inspector"); router.refresh(); }
  return <form className="package-action-form" onSubmit={submit}><label>Physical inspection result<select name="result" defaultValue="CONFIRMED"><option value="CONFIRMED">Claim confirmed</option><option value="PARTIALLY_CONFIRMED">Partially confirmed</option><option value="NOT_CONFIRMED">Not confirmed</option></select></label><label>Inspection notes<textarea name="notes" minLength={5} maxLength={2000} required placeholder="Record condition, package integrity, affected contents, and observed evidence." /></label><label>Private evidence reference <span>(optional)</span><input name="evidenceReference" maxLength={500} placeholder="rma-evidence/...jpg" /></label><p className="form-help">Do not record customer identity or financial information.</p>{error ? <p className="form-error" role="alert">{error}</p> : null}<button className="button primary" disabled={saving} type="submit">{saving ? "Saving…" : "Complete return inspection"}</button></form>;
}
