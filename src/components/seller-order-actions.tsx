"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AdminSellerOrderReview({ sellerOrderId }: { sellerOrderId: string }) {
  const router = useRouter(); const [note, setNote] = useState(""); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  async function review(action: "APPROVE" | "HOLD") { if (note.trim().length < 3) return setError("Add a review note first."); setSaving(true); setError(""); const response = await fetch(`/api/v1/admin/seller-orders/${sellerOrderId}/review`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, note }) }); const result = await response.json(); setSaving(false); if (!response.ok) return setError(result.error?.message ?? "Could not review this seller order."); router.refresh(); }
  return <div className="review-actions"><textarea aria-label="Seller order review note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Record the approval or hold reason." /><div><button className="button approve" disabled={saving} onClick={() => review("APPROVE")} type="button">Approve release</button><button className="button reject" disabled={saving} onClick={() => review("HOLD")} type="button">Place on hold</button></div>{error ? <p className="form-error" role="alert">{error}</p> : null}</div>;
}

export function SellerOrderPreparationAction({ sellerOrderId, status }: { sellerOrderId: string; status: string }) {
  const router = useRouter(); const [note, setNote] = useState(""); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  const action = status === "APPROVED" ? "START_PREPARING" : "MARK_READY";
  const label = action === "START_PREPARING" ? "Start preparing" : "Mark ready for collection";
  async function update() { if (note.trim().length < 3) return setError("Add a short preparation update."); setSaving(true); setError(""); const response = await fetch(`/api/v1/seller/orders/${sellerOrderId}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, note }) }); const result = await response.json(); setSaving(false); if (!response.ok) return setError(result.error?.message ?? "Could not update this order."); setNote(""); router.refresh(); }
  return <div className="order-status-form"><label htmlFor={`seller-note-${sellerOrderId}`}>Preparation note</label><textarea id={`seller-note-${sellerOrderId}`} value={note} onChange={(event) => setNote(event.target.value)} placeholder={action === "START_PREPARING" ? "Example: Stock confirmed; packing has started." : "Example: Packed, labelled, and ready for pickup."} /><button className="button primary" disabled={saving} onClick={update} type="button">{saving ? "Saving…" : label}</button>{error ? <p className="form-error" role="alert">{error}</p> : null}</div>;
}
