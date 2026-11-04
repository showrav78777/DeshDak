"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function CouponCreateForm() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/v1/admin/coupons", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      code: form.get("code"), name: form.get("name"), description: form.get("description"), discountType: form.get("discountType"), discountValue: form.get("discountValue"), minimumOrderAmount: form.get("minimumOrderAmount"), maximumDiscount: form.get("maximumDiscount"), totalUsageLimit: form.get("totalUsageLimit"), perCustomerLimit: form.get("perCustomerLimit"), perDayLimit: form.get("perDayLimit"), eligibleAccountType: form.get("eligibleAccountType"), firstOrderOnly: form.get("firstOrderOnly") === "on", allowsAutomaticStacking: form.get("allowsAutomaticStacking") === "on", startsAt: form.get("startsAt"), endsAt: form.get("endsAt"),
    }) });
    const result = await response.json();
    setSaving(false);
    if (!response.ok) return setError(result.error?.message ?? "Unable to create this coupon.");
    event.currentTarget.reset();
    router.refresh();
  }

  return <form className="coupon-create-form" onSubmit={submit}>
    <fieldset><legend>1. Coupon identity</legend><div className="offer-form-grid"><label>Coupon code<input autoCapitalize="characters" maxLength={40} name="code" placeholder="WELCOME10" required /><small>Customers enter this at checkout.</small></label><label>Display name<input maxLength={120} name="name" placeholder="Welcome discount" required /></label><label className="wide">Internal note <span>(optional)</span><textarea maxLength={500} name="description" placeholder="Why this coupon was created" /></label></div></fieldset>
    <fieldset><legend>2. Discount and audience</legend><div className="offer-form-grid"><label>Discount type<select name="discountType"><option value="PERCENTAGE">Percentage</option><option value="FIXED_AMOUNT">Fixed BDT amount</option></select></label><label>Discount value<input min="0.01" name="discountValue" placeholder="10" required step="0.01" type="number" /></label><label>Minimum product total<input defaultValue="0" min="0" name="minimumOrderAmount" required step="0.01" type="number" /></label><label>Maximum discount <span>(optional)</span><input min="0.01" name="maximumDiscount" placeholder="No maximum" step="0.01" type="number" /></label><label>Eligible accounts<select name="eligibleAccountType"><option value="">All customers</option><option value="PERSONAL">Personal only</option><option value="BUSINESS">Business only</option></select></label><div className="offer-checks"><label className="coupon-check"><input name="firstOrderOnly" type="checkbox" /> First order only</label><label className="coupon-check"><input name="allowsAutomaticStacking" type="checkbox" /> Allow automatic promotion stacking</label></div></div></fieldset>
    <fieldset><legend>3. Limits and schedule</legend><div className="offer-form-grid"><label>Total usage limit <span>(optional)</span><input min="1" name="totalUsageLimit" placeholder="Unlimited" type="number" /></label><label>Per-customer limit<input defaultValue="1" min="1" name="perCustomerLimit" required type="number" /></label><label>Daily global limit <span>(optional)</span><input min="1" name="perDayLimit" placeholder="Unlimited" type="number" /></label><span aria-hidden="true" className="offer-form-spacer" /><label>Starts at<input name="startsAt" required type="datetime-local" /></label><label>Ends at<input name="endsAt" required type="datetime-local" /></label></div></fieldset>
    {error ? <p className="form-error" role="alert">{error}</p> : null}<div className="offer-form-submit"><p>The coupon is saved as a draft. You can review it before activation.</p><button className="button primary" disabled={saving} type="submit">{saving ? "Creating…" : "Create draft coupon"}</button></div>
  </form>;
}

export function CouponStatusControl({ couponId, status, version }: { couponId: string; status: string; version: number }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmEnd, setConfirmEnd] = useState(false);
  const next = status === "ACTIVE" ? "PAUSED" : "ACTIVE";

  async function change(nextStatus: "ACTIVE" | "PAUSED" | "EXPIRED") {
    setSaving(true);
    setError("");
    const response = await fetch(`/api/v1/admin/coupons/${couponId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: nextStatus, version }) });
    const result = await response.json();
    setSaving(false);
    if (!response.ok) return setError(result.error?.message ?? "Unable to update this coupon.");
    router.refresh();
  }

  if (status === "EXPIRED") return null;
  return <div className="coupon-status-control"><button disabled={saving} onClick={() => change(next)} type="button">{saving ? "Saving…" : next === "ACTIVE" ? "Activate" : "Pause"}</button>{confirmEnd ? <><button className="danger" disabled={saving} onClick={() => change("EXPIRED")} type="button">Confirm permanent end</button><button className="quiet" disabled={saving} onClick={() => setConfirmEnd(false)} type="button">Cancel</button></> : <button className="danger" disabled={saving} onClick={() => setConfirmEnd(true)} type="button">End permanently</button>}{error ? <small className="form-error">{error}</small> : null}</div>;
}
