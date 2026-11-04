"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { usePaymentMethods } from "@/components/use-payment-methods";

export function OrderPayment({ orderId, amount, currency, displayAmount, displayCurrency, destinationCountryCode, walletBalance, sellerOrder = false }: { orderId: string; amount: string; currency: string; displayAmount?: string; displayCurrency?: "BDT" | "USD"; destinationCountryCode: string; walletBalance: string; sellerOrder?: boolean }) {
  const router = useRouter();
  const [provider, setProvider] = useState("WALLET");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const idempotencyKey = useRef(crypto.randomUUID());
  const canUseWallet = Number(walletBalance) >= Number(amount);
  const available = usePaymentMethods(destinationCountryCode, currency, amount);

  async function pay() {
    setMessage("");
    setLoading(true);
    const wallet = provider === "WALLET";
    try {
      const response = await fetch(wallet ? "/api/v1/payments/wallet" : "/api/v1/payments/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey.current },
        body: JSON.stringify(wallet ? { orderId } : { orderId, provider }),
      });
      const result = await response.json();
      if (!response.ok) {
        setMessage(result.error?.message ?? "Unable to begin payment.");
        return;
      }
      if (wallet) {
        setMessage(sellerOrder ? "Payment completed. Your order is waiting for administrator review before release to the seller." : "Payment completed. Your order is now waiting for administrator purchase review.");
        router.refresh();
      } else {
        if (result.data.nextAction !== "REDIRECT" || typeof result.data.redirectUrl !== "string") {
          setMessage("The payment page was not returned. No payment was taken; please retry.");
          return;
        }
        window.location.assign(result.data.redirectUrl);
      }
    } catch {
      setMessage("The payment service could not be reached. No duplicate payment was created; please try again.");
    } finally {
      setLoading(false);
    }
  }

  const noUsableMethod = !canUseWallet && !available.loading && available.methods.length === 0;
  const displayTotal = displayCurrency === "USD" ? (displayAmount ? `$${displayAmount}` : "USD rate unavailable") : `৳${amount}`;
  return <section className="detail-card order-payment-card"><div><p className="eyebrow">PAYMENT REQUIRED</p><h2>Complete secure payment</h2><p>Your order is saved, but the administrator will not purchase it until payment is verified and the order is reviewed.</p></div><div className="detail-total"><span>Order total</span><b>{displayTotal}</b></div><div className="payment-start"><select aria-label="Payment method" value={provider} onChange={(event) => { setProvider(event.target.value); idempotencyKey.current = crypto.randomUUID(); }}><option disabled={!canUseWallet} value="WALLET">Wallet — ৳{walletBalance}{canUseWallet ? "" : " (insufficient)"}</option>{available.methods.map((method) => <option key={`${method.code}:${method.currency}`} value={method.code}>{method.displayName} — {method.currency} {method.payableAmount}</option>)}</select><button className="button dark" disabled={loading || available.loading || noUsableMethod || (provider === "WALLET" && !canUseWallet)} onClick={pay} type="button">{loading ? "Processing…" : available.loading ? "Checking methods…" : provider === "WALLET" ? "Pay securely from wallet" : "Continue to secure payment"}</button>{available.error ? <p className="form-error" role="alert">{available.error}</p> : null}{noUsableMethod ? <p className="form-help">No approved payment method is currently available for this destination, currency, and amount.</p> : null}{message ? <p className="form-help" role="status">{message}</p> : null}</div></section>;
}
