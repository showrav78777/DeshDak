"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function ShippingPayment({ orderId, amount, walletBalance }: { orderId: string; amount: string; walletBalance: string }) {
  const router = useRouter();
  const requestKey = useRef<string | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const enoughBalance = Number(walletBalance) >= Number(amount);

  async function pay() {
    requestKey.current ??= crypto.randomUUID();
    setWorking(true); setError("");
    try {
      const response = await fetch("/api/v1/payments/shipping/wallet", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": requestKey.current }, body: JSON.stringify({ orderId }) });
      const result = await response.json().catch(() => null);
      if (!response.ok) return setError(result?.error?.message ?? "Shipping payment could not be completed.");
      router.refresh();
    } catch { setError("Shipping payment could not be confirmed. Check your connection and retry safely."); }
    finally { setWorking(false); }
  }

  return <section className="detail-card shipping-quote-card"><div className="shipping-quote-title"><div><p className="eyebrow">SECURE SHIPPING PAYMENT</p><h2>Pay the confirmed international shipping amount</h2></div><b>৳{amount}</b></div><p className="shipping-quote-explain">This payment is recorded separately from your product payment. Your package moves to Ready to ship only after the wallet debit succeeds.</p><div className="detail-total"><span>Available wallet balance</span><b>৳{walletBalance}</b></div><div className="shipping-decision-actions"><button className="button primary" disabled={working || !enoughBalance} onClick={pay} type="button">{working ? "Processing securely…" : "Pay shipping from wallet"}</button></div>{!enoughBalance ? <p className="form-error">Your wallet needs ৳{(Number(amount) - Number(walletBalance)).toFixed(2)} more before this payment can be completed.</p> : null}{error ? <p className="form-error" role="alert">{error}</p> : null}</section>;
}
