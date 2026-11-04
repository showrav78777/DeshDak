"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function SupplierDispatchForm({ orderId, recordId }: { orderId: string; recordId: string }) {
  const router = useRouter();
  const pending = useRef(false);
  const attempt = useRef<{ payload: string; key: string } | null>(null);
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  const [completed, setCompleted] = useState(false);
  const confirmed = useRef(false);
  return <form className="integration-create-form" onSubmit={async event => {
    event.preventDefault(); if (pending.current || confirmed.current) return;
    const form = event.currentTarget, fields = new FormData(form);
    const payload = JSON.stringify({ carrierName: fields.get("carrierName"), trackingNumber: fields.get("trackingNumber") });
    if (attempt.current?.payload !== payload) attempt.current = { payload, key: `supplier-dispatch:${crypto.randomUUID()}` };
    pending.current = true; setSaving(true); setError("");
    try {
      const response = await fetch(`/api/v1/admin/orders/${orderId}/supplier-records/${recordId}/dispatch`, { method: "POST", credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(15_000), headers: { "Content-Type": "application/json", "Idempotency-Key": attempt.current!.key }, body: payload });
      if (!response.ok) { setError("Dispatch not confirmed. Refresh and review the order stage, tracking and existing parcels before retrying."); return; }
      const result = await response.json();
      if (!result?.data?.dispatch?.id) throw new Error("Unconfirmed dispatch");
      confirmed.current = true; setCompleted(true); router.refresh();
    } catch { setError("Dispatch could not be confirmed; it may already have been saved. Refresh before retrying."); }
    finally { pending.current = false; setSaving(false); }
  }}><h3>Record dispatch to origin warehouse</h3><p>Verify the real supplier dispatch confirmation. One parcel per supplier record. Saving creates an expected arrival, not a physical receipt. All supplier records must be dispatched before receiving starts.</p>
    <label>Domestic carrier<input name="carrierName" required minLength={2} maxLength={80} disabled={saving || completed} /></label>
    <label>Domestic tracking reference<input name="trackingNumber" required minLength={4} maxLength={80} pattern="[A-Za-z0-9][A-Za-z0-9\-]{3,79}" disabled={saving || completed} /></label>
    <label><input type="checkbox" required disabled={saving || completed} /> I checked the supplier dispatch confirmation.</label>
    <button className="button primary" disabled={saving || completed} type="submit">{completed ? "Expected arrival saved" : saving ? "Recording…" : "Save expected arrival"}</button>{completed && <p role="status">Expected arrival saved. Refreshing the order; do not submit again. If the view does not update, reload and review the recorded parcel.</p>}{error && <p role="alert" className="form-error">{error}</p>}
  </form>;
}
