"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function PaymentRiskDecisionForm({ paymentId }: { paymentId: string }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"APPROVED" | "REJECTED" | null>(null);
  const [message, setMessage] = useState("");

  async function decide(decision: "APPROVED" | "REJECTED") {
    setMessage("");
    if (reason.trim().length < 10) return setMessage("Add a clear review reason of at least 10 characters.");
    setBusy(decision);
    try {
      const response = await fetch(`/api/v1/admin/payment-risk/${paymentId}/decision`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ decision, reason }) });
      const result = await response.json();
      if (!response.ok) return setMessage(result.error?.message ?? "The payment decision could not be saved.");
      setMessage(decision === "APPROVED" ? "Payment approved and the verified order was released for Admin purchase review." : "Payment rejected. It remains financially unresolved for refund or settlement investigation.");
      router.refresh();
    } catch { setMessage("The decision service could not be reached. Refresh before trying again."); }
    finally { setBusy(null); }
  }

  return <div className="review-actions payment-risk-actions"><label><span>Decision reason</span><textarea maxLength={1000} onChange={(event) => setReason(event.target.value)} placeholder="Record the evidence checked and why this payment should be approved or rejected." value={reason} /></label><div><button className="button approve" disabled={Boolean(busy)} onClick={() => void decide("APPROVED")} type="button">{busy === "APPROVED" ? "Approving…" : "Approve verified payment"}</button><button className="button reject" disabled={Boolean(busy)} onClick={() => void decide("REJECTED")} type="button">{busy === "REJECTED" ? "Rejecting…" : "Reject and investigate"}</button></div>{message ? <p className={message.startsWith("Payment ") ? "form-success" : "form-error"} role="status">{message}</p> : null}</div>;
}
