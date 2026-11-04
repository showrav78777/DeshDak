"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SUPPLIER_RECORD_LIMIT, supplierRecordLimitReached } from "@/modules/sourcing/supplier-record-limit";

export function SupplierRecordReplacementForm({ orderId, record, holdHistoryId, retainedRecords }: { orderId: string; record: { id: string; supplierName: string; supplierOrderReference: string; variantDescription: string }; holdHistoryId: string; retainedRecords: number }) {
  const router = useRouter();
  const pending = useRef(false);
  const attempt = useRef<{ payload: string; key: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [completed, setCompleted] = useState(false);
  const confirmed = useRef(false);
  if (supplierRecordLimitReached(retainedRecords)) return <section aria-label="Correction capacity review"><h3>Correction requires operations review</h3><p>A replacement adds a retained evidence record. This order has reached the {SUPPLIER_RECORD_LIMIT}-record limit, including superseded records, so approval is unavailable here. Keep the order on hold and ask operations to review it. Do not delete evidence or release the hold to bypass this limit.</p></section>;
  return <form className="integration-create-form" onSubmit={async event => {
    event.preventDefault(); if (pending.current || confirmed.current) return;
    const fields = new FormData(event.currentTarget);
    const payload = JSON.stringify({ supplierName: fields.get("supplierName"), supplierOrderReference: fields.get("supplierOrderReference"), variantDescription: fields.get("variantDescription"), reason: fields.get("reason"), holdHistoryId });
    if (attempt.current?.payload !== payload) attempt.current = { payload, key: `supplier-correction:${crypto.randomUUID()}` };
    pending.current = true; setSaving(true); setError("");
    try {
      const response = await fetch(`/api/v1/admin/orders/${orderId}/supplier-records/${record.id}/correction`, { method: "POST", credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(15_000), headers: { "Content-Type": "application/json", "Idempotency-Key": attempt.current!.key }, body: payload });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        setError(result?.error?.code === "RECORD_LIMIT" ? "The evidence-record limit was reached. Keep the order on hold and ask operations to review it; do not delete evidence." : result?.error?.code === "INDEPENDENT_ADMIN_REQUIRED" ? "A different Admin must review this; the recorder and reporter cannot approve." : "Correction not confirmed. Refresh and review the latest hold, fields and Admin authorization before retrying."); return;
      }
      const result = await response.json();
      if (!result?.data?.record?.id) throw new Error("Unconfirmed correction");
      confirmed.current = true; setCompleted(true); router.refresh();
    } catch { setError("Correction could not be confirmed; it may already have been saved. Refresh before retrying."); }
    finally { pending.current = false; setSaving(false); }
  }}><h3>Independent Admin review</h3><p>Verify the real supplier confirmation. Approval creates a replacement record and returns the order to Sourcing. The original stays visible. Item, quantity, warehouse, money and supplier purchase are unchanged.</p>
    <label>Correct supplier name<input name="supplierName" required maxLength={120} defaultValue={record.supplierName} disabled={saving || completed} /></label>
    <label>Correct supplier reference<input name="supplierOrderReference" required maxLength={120} defaultValue={record.supplierOrderReference} disabled={saving || completed} /></label>
    <label>Correct variant description<input name="variantDescription" required maxLength={300} defaultValue={record.variantDescription} disabled={saving || completed} /></label>
    <label>Approval reason<textarea name="reason" required minLength={3} maxLength={120} disabled={saving || completed} /></label>
    <label><input type="checkbox" required disabled={saving || completed} /> I independently verified this correction and approve return to Sourcing.</label>
    <button className="button primary" type="submit" disabled={saving || completed}>{completed ? "Replacement approved" : saving ? "Approving…" : "Approve replacement & return to Sourcing"}</button>{completed && <p role="status">Replacement approved. Refreshing the order; do not approve again. If the view does not update, reload and review the retained evidence.</p>}{error && <p className="form-error" role="alert">{error}</p>}
  </form>;
}
