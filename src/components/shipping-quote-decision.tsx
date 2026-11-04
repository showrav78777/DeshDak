"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type QuoteView = { totalBdt: string; shippingAmountBdt: string; lastMileDeliveryBdt: string; handlingFeeBdt: string; insuranceFeeBdt: string; chargeableWeightGrams: number; declaredWeightGrams: number | null; discrepancyPercent: string | null; expiresAt: string; note: string | null; status: string };

export function ShippingQuoteDecision({ orderId, approvalRequired, quote }: { orderId: string; approvalRequired: boolean; quote: QuoteView }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [working, setWorking] = useState<"accept" | "reject" | null>(null);
  async function decide(action: "accept" | "reject") {
    if (action === "reject" && !window.confirm("Place shipping on hold? Your purchased product order will remain recorded.")) return;
    setError(""); setWorking(action);
    try {
      const response = await fetch(`/api/v1/orders/${orderId}/shipping-quote/${action}`, { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() } });
      const result = await response.json();
      if (!response.ok) return setError(result.error?.message ?? "Could not save your decision.");
      router.refresh();
    } catch { setError("Could not save your decision. Check your connection and try again."); }
    finally { setWorking(null); }
  }
  return <section className="detail-card shipping-quote-card"><div className="shipping-quote-title"><div><p className="eyebrow">FINAL SHIPPING QUOTE</p><h2>{approvalRequired ? "Review the measured shipping amount" : "Your measured shipping amount"}</h2></div><b>৳{quote.totalBdt}</b></div><p className="shipping-quote-explain">This is separate from your product payment. It is based on the warehouse-confirmed chargeable weight of {(quote.chargeableWeightGrams / 1000).toFixed(3)} kg.</p><dl className="shipping-charge-breakdown"><div><dt>International air / sea shipping</dt><dd>৳{quote.shippingAmountBdt}</dd></div>{Number(quote.lastMileDeliveryBdt) > 0 ? <div><dt>Bangladesh local courier delivery</dt><dd>৳{quote.lastMileDeliveryBdt}</dd></div> : null}{Number(quote.handlingFeeBdt) > 0 ? <div><dt>Handling</dt><dd>৳{quote.handlingFeeBdt}</dd></div> : null}{Number(quote.insuranceFeeBdt) > 0 ? <div><dt>Insurance</dt><dd>৳{quote.insuranceFeeBdt}</dd></div> : null}</dl>{quote.discrepancyPercent !== null ? <p className="weight-discrepancy"><b>Weight update</b><span>Supplier-declared: {quote.declaredWeightGrams?.toLocaleString()} g · Measured chargeable: {quote.chargeableWeightGrams.toLocaleString()} g · Difference: {quote.discrepancyPercent}%</span></p> : <p className="weight-discrepancy"><b>Weight confirmation required</b><span>No supplier-declared weight was recorded for this older order, so your approval is required.</span></p>}{quote.note ? <p className="shipping-quote-note">{quote.note}</p> : null}<small>Quote valid until {new Date(quote.expiresAt).toLocaleString()}</small>{approvalRequired && quote.status === "SENT" ? <div className="shipping-decision-actions"><button className="button primary" disabled={working !== null} onClick={() => decide("accept")} type="button">{working === "accept" ? "Accepting…" : "Accept shipping quote"}</button><button className="button secondary" disabled={working !== null} onClick={() => decide("reject")} type="button">{working === "reject" ? "Saving…" : "Do not proceed with shipping"}</button></div> : <p className="shipping-quote-ready">{quote.status === "PAID" ? "✓ Shipping payment completed. Your package is ready for dispatch." : quote.status === "ACCEPTED" ? "✓ Quote confirmed and ready for the separate shipping payment step." : quote.status === "REJECTED" ? "Shipping is on hold because you declined this quote. Your product order remains recorded." : quote.status === "EXPIRED" ? "This quote has expired. Please request an updated shipping quote." : quote.status === "CANCELLED" ? "This shipping quote was cancelled. Please wait for an updated quote." : "This quote is awaiting confirmation."}</p>}{error ? <p className="form-error" role="alert">{error}</p> : null}</section>;
}
