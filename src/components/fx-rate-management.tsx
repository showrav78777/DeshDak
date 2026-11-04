"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function FxRateCreateForm({ currencies, endpoint = "/api/v1/admin/fx-rates" }: { currencies: string[]; endpoint?: string }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError("");
    const form = new FormData(event.currentTarget);
    const validFrom = String(form.get("validFrom") ?? "");
    const validTo = String(form.get("validTo") ?? "");
    const payload = { ...Object.fromEntries(form), validFrom: validFrom ? new Date(validFrom).toISOString() : "", validTo: validTo ? new Date(validTo).toISOString() : null };
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const result = await response.json(); setSaving(false);
    if (!response.ok) return setError(result.error?.message ?? "Unable to create this rate version.");
    event.currentTarget.reset(); router.refresh();
  }
  return <form className="country-create-form" onSubmit={submit}><datalist id="fx-currencies">{currencies.map((currency) => <option key={currency} value={currency} />)}</datalist><div><label>Base currency</label><input defaultValue="BDT" list="fx-currencies" maxLength={3} name="baseCurrency" required /></div><div><label>Customer currency</label><input list="fx-currencies" maxLength={3} name="quoteCurrency" placeholder="USD" required /></div><div><label>Customer segment</label><select name="customerSegment" defaultValue="PERSONAL"><option value="PERSONAL">Personal</option><option value="BUSINESS">Business</option></select></div><div><label>Market rate</label><input min="0.00000001" name="marketRate" placeholder="0.00820000" required step="0.00000001" type="number" /></div><div><label>Customer spread (%)</label><input defaultValue="0" min="0" max="100" name="spreadPercent" required step="0.000001" type="number" /></div><div><label>Rate source</label><select name="source" defaultValue="MANUAL"><option value="MANUAL">Manual verified rate</option><option value="PRIMARY_PROVIDER">Primary provider</option><option value="FALLBACK_PROVIDER">Fallback provider</option></select></div><div><label>Source reference <span>(no credentials)</span></label><input maxLength={160} name="sourceReference" placeholder="Provider quote or ticket reference" /></div><div><label>Valid from</label><input name="validFrom" required type="datetime-local" /></div><div><label>Valid until <span>(optional)</span></label><input name="validTo" type="datetime-local" /></div>{error ? <p className="form-error" role="alert">{error}</p> : null}<button className="button primary" disabled={saving} type="submit">{saving ? "Creating…" : "Create immutable draft"}</button></form>;
}

export function FxRateWorkflow({ rateId, status, financeApproved, complianceApproved, endpointPrefix = "/api/v1/admin/fx-rates", financeOnly = false }: { rateId: string; status: string; financeApproved: boolean; complianceApproved: boolean; endpointPrefix?: string; financeOnly?: boolean }) {
  const router = useRouter(); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  async function update(payload: Record<string, unknown>) { setSaving(true); setError(""); const response = await fetch(`${endpointPrefix}/${rateId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); const result = await response.json(); setSaving(false); if (!response.ok) return setError(result.error?.message ?? "Unable to update this rate."); router.refresh(); }
  if (status === "REVOKED") return <small>Historical version · cannot be reused</small>;
  return <div className="country-toggle">{status === "DRAFT" ? <><button className="button secondary" disabled={saving || (financeOnly ? financeApproved : financeApproved && complianceApproved)} onClick={() => update(financeOnly ? { action: "FINANCE_APPROVE" } : { action: "APPROVE", financeApproved: true, complianceApproved: true })} type="button">{saving ? "Saving…" : financeOnly ? financeApproved ? "Finance approved" : "Record Finance approval" : financeApproved && complianceApproved ? "Approved" : "Record both approvals"}</button><button className="button primary" disabled={saving || !financeApproved || !complianceApproved} onClick={() => update({ action: "ACTIVATE" })} type="button">Activate version</button></> : <button className="button secondary" disabled={saving} onClick={() => update({ action: "REVOKE" })} type="button">{saving ? "Revoking…" : "Revoke rate"}</button>}{error ? <p className="form-error" role="alert">{error}</p> : null}</div>;
}
