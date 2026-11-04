"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type LaneOption = { id: string; label: string };

export function ShippingQuoteForm({ orderId, lanes }: { orderId: string; lanes: LaneOption[] }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setIsSaving(true);
    const form = Object.fromEntries(new FormData(event.currentTarget));
    const expires = new Date(String(form.expiresAt));
    if (Number.isNaN(expires.getTime())) { setIsSaving(false); return setError("Choose a valid future expiry time."); }
    try {
      const response = await fetch(`/api/v1/admin/orders/${orderId}/shipping-quote`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, expiresAt: expires.toISOString() }) });
      const result = await response.json();
      if (!response.ok) return setError(result.error?.message ?? "Could not issue the shipping quote.");
      router.refresh();
    } catch { setError("Could not confirm the shipping quote. Check your connection, refresh this order, and review its latest quote before retrying."); }
    finally { setIsSaving(false); }
  }

  return <form className="quote-form shipping-final-quote-form" onSubmit={submit}>
    <div className="shipping-quote-form-guide"><b>1. Select the approved lane</b><span>2. Enter the measured shipping rates and fees</span><span>3. Send one clear quote to the customer</span></div>
    <div className="quote-fields">
      <label>Active shipping service<select name="shippingLaneId" required defaultValue=""><option value="">Choose an approved service</option>{lanes.map((lane) => <option key={lane.id} value={lane.id}>{lane.label}</option>)}</select></label>
      <label>International rate per kg (BDT)<input name="ratePerKgBdt" placeholder="Example: 800" type="number" min="0.01" step="0.01" required /></label>
      <label>Bangladesh courier rate per kg (BDT)<input name="lastMileRatePerKgBdt" type="number" min="0" step="0.01" defaultValue="0" required /><small>Enter 0 if delivery is included or the destination is outside Bangladesh.</small></label>
      <div className="quote-fee-row"><label>Handling fee (BDT)<input name="handlingFeeBdt" type="number" min="0" step="0.01" defaultValue="0" required /></label><label>Insurance fee (BDT)<input name="insuranceFeeBdt" type="number" min="0" step="0.01" defaultValue="0" required /></label></div>
      <label>Quote expiry<input name="expiresAt" type="datetime-local" required /></label>
    </div>
    <label className="quote-note-field">Customer note <span>(optional)</span><textarea name="note" placeholder="Explain the air or sea service, delivery estimate, and any important measurement change." /></label>
    {!lanes.length ? <p className="form-error" role="alert">No active shipping service is available for this route. An administrator must enable a shipping lane first.</p> : null}
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <button className="button primary" disabled={isSaving || !lanes.length} type="submit">{isSaving ? "Issuing quote…" : "Send final quote to customer"}</button>
  </form>;
}
