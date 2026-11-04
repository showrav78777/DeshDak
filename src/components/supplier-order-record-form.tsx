"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function SupplierOrderRecordForm({ orderId, items, warehouses }: { orderId: string; items: { id: string; label: string; remaining: number }[]; warehouses: { id: string; label: string }[] }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const attempt = useRef<{ payload: string; key: string } | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending.current) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const payload = JSON.stringify({ orderItemId: fields.get("orderItemId") || null, supplierName: fields.get("supplierName"), supplierOrderReference: fields.get("supplierOrderReference"), variantDescription: fields.get("variantDescription"), quantity: Number(fields.get("quantity")), originWarehouseId: fields.get("originWarehouseId"), internalNote: fields.get("internalNote") });
    if (attempt.current?.payload !== payload) attempt.current = { payload, key: `supplier-record:${crypto.randomUUID()}` };
    pending.current = true; setSaving(true); setError("");
    try {
      const response = await fetch(`/api/v1/admin/orders/${orderId}/supplier-records`, { method: "POST", credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(15_000), headers: { "Content-Type": "application/json", "Idempotency-Key": attempt.current!.key }, body: payload });
      if (!response.ok) {
        setError(response.status === 403 ? "Sign in as Admin and complete MFA." : "Record not confirmed. Refresh and check the quantity, warehouse, order stage and existing references before trying again.");
        return;
      }
      const result = await response.json();
      if (!result?.data?.record?.id) throw new Error("Unconfirmed record");
      attempt.current = null; form.reset(); router.refresh();
    } catch { setError("Save could not be confirmed. Refresh before retrying; this record may already have been saved."); }
    finally { pending.current = false; setSaving(false); }
  }
  const available = items.filter(item => item.remaining > 0);
  return <form className="integration-create-form" onSubmit={submit}>
    <h2>Add a supplier reference</h2><p>Private operational evidence only. This does not create a payable, prove payment, upload a receipt or mark the customer order purchased. Records cannot be edited or deleted.</p>
    <label>Ordered item<select name="orderItemId" required={items.some(item => item.id)} defaultValue={available.length === 1 ? available[0].id : ""}>{available.length !== 1 && <option value="">Choose ordered item</option>}{available.map(item => <option key={item.id || "request"} value={item.id}>{item.label} · {item.remaining} remaining</option>)}</select></label>
    <label>Supplier name <input name="supplierName" required maxLength={120} autoComplete="off" /></label>
    <label>Supplier order reference <input name="supplierOrderReference" required maxLength={120} autoComplete="off" /></label>
    <label>Exact variant or SKU <input name="variantDescription" required maxLength={300} /></label>
    <label>Quantity in this supplier order <input name="quantity" type="number" min="1" max="1000000" step="1" defaultValue="1" required /></label>
    <label>Receiving origin warehouse<select name="originWarehouseId" required defaultValue={warehouses.length === 1 ? warehouses[0].id : ""}><option value="">Choose origin warehouse</option>{warehouses.map(warehouse => <option key={warehouse.id} value={warehouse.id}>{warehouse.label}</option>)}</select></label>
    <label>Internal note <textarea name="internalNote" maxLength={500} /></label><small>No credentials, payment-card details or receipt URLs. Use a separate, approved process for financial evidence.</small>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="button primary" type="submit" disabled={saving || !available.length || !warehouses.length}>{saving ? "Saving…" : "Save private supplier record"}</button>
  </form>;
}
