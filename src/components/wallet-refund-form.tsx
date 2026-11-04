"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type RefundableOrder = { id: string; orderId: string; rmaId?: string; approvedGross?: string; approvedReason?: string; label: string; grossRemaining: string; settlementRemaining: string; baseCurrency: string; settlementCurrency: string; provider: string };

export function WalletRefundForm({ orders, endpoint = "/api/v1/admin/refunds/wallet" }: { orders: RefundableOrder[]; endpoint?: string }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const selected = orders.find((order) => order.id === selectedId);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setSuccess(""); setSaving(true);
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ orderId: selected?.orderId, rmaId: selected?.rmaId, grossAmount: values.grossAmount, reason: values.reason, walletConsentConfirmed: values.walletConsentConfirmed === "on" }) });
    const result = await response.json(); setSaving(false);
    if (!response.ok) return setError(result.error?.message ?? "Could not post this refund.");
    const calculation = result.data.refund.calculation;
    setSuccess(`Refund ${result.data.refund.reference}: ${calculation.baseCurrency} ${calculation.requestedGrossAmount} approved, ${calculation.baseCurrency} ${calculation.promotionNetted} promotion netted, ${result.data.refund.currency} ${result.data.refund.amount} credited.`);
    form.reset(); setSelectedId(""); router.refresh();
  }

  return <form className="country-create-form" onSubmit={submit}><div><label htmlFor="refundOrder">Approved claim or paid order</label><select id="refundOrder" required value={selectedId} onChange={(event) => setSelectedId(event.target.value)}><option value="">Choose approved work</option>{orders.map((order) => <option key={order.id} value={order.id}>{order.label} · gross remaining {order.baseCurrency} {order.grossRemaining}</option>)}</select></div><div><label htmlFor="refundGrossAmount">Approved gross amount before promotion</label><input id="refundGrossAmount" key={`amount-${selectedId}`} name="grossAmount" type="number" min="0.01" max={selected?.rmaId ? selected.approvedGross : selected?.grossRemaining} step="0.01" defaultValue={selected?.approvedGross} readOnly={Boolean(selected?.rmaId)} required /><small>{selected ? selected.rmaId ? "Locked to the evidence-based claim approval. The server still nets promotion and uses the original FX snapshot." : `Maximum gross ${selected.baseCurrency} ${selected.grossRemaining}; settlement balance ${selected.settlementCurrency} ${selected.settlementRemaining}. The server calculates promotion netting and locked-FX settlement.` : "Choose an approved claim or paid order to see its controlled refund basis."}</small></div><div><label htmlFor="refundReason">Approved reason</label><textarea id="refundReason" key={`reason-${selectedId}`} name="reason" minLength={5} required defaultValue={selected?.approvedReason} placeholder="Record the approved refund decision and reason." /></div><label className="refund-consent"><input name="walletConsentConfirmed" type="checkbox" required={selected?.provider !== "WALLET"} /> {selected?.provider === "WALLET" ? "Confirm this returns to the original app-wallet payment method." : "Customer explicitly agreed to receive this external-payment refund in the app wallet."}</label>{error ? <p className="form-error" role="alert">{error}</p> : null}{success ? <p className="form-success" role="status">{success}</p> : null}<button className="button primary" disabled={saving || !orders.length} type="submit">{saving ? "Calculating & posting…" : "Calculate and credit refund"}</button></form>;
}
