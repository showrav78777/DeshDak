"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useClientReady } from "@/components/use-client-ready";

export function SupplierRecordCorrection({ orderId, recordId }: { orderId: string; recordId: string }) {
  const router = useRouter();
  const pending = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const ready = useClientReady();
  // A native summary can toggle before hydration, mutating the server's `open`
  // attribute. Keep the whole disclosure inert until its client handler is ready.
  return <>{!ready ? <p>Preparing secure correction form. Enable JavaScript if it stays unavailable. No hold has been placed.</p> : null}<details inert={!ready}><summary>Report record mistake</summary><form method="post" className="integration-create-form" onSubmit={async event => {
    event.preventDefault();
    if (!ready || pending.current) return;
    const form = event.currentTarget;
    const note = String(new FormData(form).get("reason") ?? "").trim();
    if (note.length < 3) { setError("Explain the mistake in at least 3 characters."); return; }
    pending.current = true; setSaving(true); setError("");
    try {
      const response = await fetch(`/api/v1/admin/orders/${orderId}/purchase-review`, { method: "PATCH", credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(15_000), headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "PLACE_ON_HOLD", note, supplierRecordId: recordId }) });
      if (!response.ok) { setError(response.status === 409 ? "The stage or record changed. Refresh and review before retrying." : "Unable to confirm. Check your Admin session and refresh before retrying."); return; }
      const result = await response.json();
      if (result?.data?.order?.status !== "ON_HOLD") throw new Error("Unconfirmed hold");
      form.reset(); router.refresh();
    } catch { setError("Hold could not be confirmed; it may already have been saved. Refresh before retrying."); }
    finally { pending.current = false; setSaving(false); }
  }}><p>This pauses the order and links your private reason to this record. It does not edit evidence, cancel the supplier purchase or refund money. Escalate to operations; do not create replacement evidence yet.</p><label htmlFor={`correction-${recordId}`}>Private correction reason</label><textarea id={`correction-${recordId}`} name="reason" required minLength={3} maxLength={500} disabled={saving} /><label><input type="checkbox" required disabled={saving} /> I understand this places the entire order on hold.</label><button type="submit" className="button reject" disabled={!ready || saving}>{saving ? "Placing on hold…" : "Report mistake & hold order"}</button>{error && <p className="form-error" role="alert">{error}</p>}</form></details></>;
}
