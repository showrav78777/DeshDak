"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function PurchaseReviewActions({ orderId, status }: { orderId: string; status: string }) {
  const router = useRouter(); const [note, setNote] = useState(""); const [error, setError] = useState(""); const [isSaving, setIsSaving] = useState(false);
  async function update(action: "APPROVE_FOR_PURCHASE" | "MARK_PURCHASED" | "PLACE_ON_HOLD") {
    if (isSaving) return;
    if (note.trim().length < 3) return setError("Add a short internal note first.");
    setError(""); setIsSaving(true);
    try {
      const response = await fetch(`/api/v1/admin/orders/${orderId}/purchase-review`, { method: "PATCH", credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(15_000), headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, note }) });
      if (response.status === 409) {
        const conflict = await response.json().catch(() => null);
        setError(conflict?.error?.code === "SUPPLIER_RECORDS_REQUIRED" ? "Open Supplier references & items and record the full ordered quantity before marking purchased." : "Order stage changed. Refresh before submitting another decision.");
        router.refresh(); return;
      }
      if (response.status === 401 || response.status === 403) { setError("Sign in as Admin and complete MFA before continuing."); return; }
      if (!response.ok) { setError("Could not confirm this update. Refresh the order before trying again."); return; }
      const result = await response.json();
      if (!result?.data?.order?.id) throw new Error("Unconfirmed update");
      setNote(""); router.refresh();
    } catch {
      setError("Update could not be confirmed. Refresh the order before trying again; it may already have been saved.");
    } finally { setIsSaving(false); }
  }
  const isReview = status === "PENDING_PURCHASE_REVIEW";
  return <div className="review-actions purchase-review-actions"><p><b>{isReview ? "Step 1 · Verify before approval" : "Step 2 · Record the actual purchase"}</b></p><p>{isReview ? "Confirm the exact variant, quantity, supplier stock and current price. Place the order on hold if anything is uncertain." : "Purchase externally only after approval. Check the supplier confirmation and retain the receipt before marking purchased."}</p><label htmlFor={`purchase-note-${orderId}`}>Internal Admin note</label><textarea id={`purchase-note-${orderId}`} maxLength={500} aria-describedby={`purchase-note-help-${orderId}`} value={note} onChange={(event) => setNote(event.target.value)} placeholder={isReview ? "Stock, variant and price verification summary" : "Internal purchase reference and verification summary"} /><small id={`purchase-note-help-${orderId}`}>Saved in the internal audit log, not the customer timeline. Do not enter credentials or payment-card details. Customers receive a standard status update.</small><div><button className="button approve" disabled={isSaving} onClick={() => update(isReview ? "APPROVE_FOR_PURCHASE" : "MARK_PURCHASED")} type="button">{isSaving ? "Saving…" : isReview ? "Approve for purchase" : "Mark purchased"}</button><button className="button reject" disabled={isSaving} onClick={() => update("PLACE_ON_HOLD")} type="button">Place on hold</button></div>{error ? <p className="form-error" role="alert">{error}</p> : null}</div>;
}
