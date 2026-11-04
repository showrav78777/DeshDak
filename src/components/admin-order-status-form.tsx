"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const labels: Record<string, string> = { SUPPLIER_SHIPPED: "Supplier shipped", SELLER_PREPARING: "Seller preparing", READY_FOR_COLLECTION: "Ready for collection", WAREHOUSE_RECEIVED: "Received at origin warehouse", INSPECTION: "Start inspection", MEASURED: "Package measured", SHIPPING_QUOTE_PENDING_CUSTOMER_APPROVAL: "Shipping approval needed", SHIPPING_QUOTE_READY: "Shipping quote ready", SHIPPING_PAYMENT_PENDING: "Shipping payment pending", READY_TO_SHIP: "Ready to ship", IN_TRANSIT: "In transit", CUSTOMS: "Customs processing", BD_WAREHOUSE: "Received in Bangladesh", DESTINATION_WAREHOUSE: "Received at destination hub", OUT_FOR_DELIVERY: "Out for delivery", DELIVERED: "Delivered", ON_HOLD: "Place on hold", CANCELLED: "Cancel order", REFUNDED: "Refunded", PURCHASED: "Resume purchased stage" };
const explanations: Record<string, string> = { SUPPLIER_SHIPPED: "The supplier has handed the package to the origin carrier.", SELLER_PREPARING: "The seller is preparing the confirmed products.", READY_FOR_COLLECTION: "The seller has packed the products and they are ready for collection.", WAREHOUSE_RECEIVED: "The package has arrived at the origin warehouse.", INSPECTION: "Warehouse staff are checking product condition and quantity.", MEASURED: "Package weight and dimensions have been recorded.", READY_TO_SHIP: "Shipping payment is confirmed and the package can leave the warehouse.", IN_TRANSIT: "The international shipment has departed.", CUSTOMS: "The shipment is being processed by customs.", BD_WAREHOUSE: "The shipment has arrived at the Bangladesh warehouse.", DESTINATION_WAREHOUSE: "The shipment has arrived at the destination hub.", OUT_FOR_DELIVERY: "The local courier has the parcel and will deliver it next.", DELIVERED: "The customer has received the order. This completes the delivery workflow.", ON_HOLD: "Pause the order only while a real issue is investigated.", CANCELLED: "Cancel the order. Use only when the cancellation is confirmed.", REFUNDED: "Confirm the refund after finance has completed it." };

export function AdminOrderStatusForm({ orderId, allowedStatuses }: { orderId: string; allowedStatuses: string[] }) {
  const router = useRouter();
  const recommendedStatus = allowedStatuses.find((item) => !["ON_HOLD", "CANCELLED", "REFUNDED"].includes(item)) ?? allowedStatuses[0] ?? "";
  const [status, setStatus] = useState(recommendedStatus);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const selectedStatus = allowedStatuses.includes(status) ? status : recommendedStatus;
  const hasAlternative = allowedStatuses.length > 1;

  async function save() {
    if (!selectedStatus) return setError("No next stage is available.");
    if (note.trim().length < 3) return setError("Add a short customer-facing update note.");
    setError(""); setIsSaving(true);
    const response = await fetch(`/api/v1/admin/orders/${orderId}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: selectedStatus, note }) });
    const result = await response.json(); setIsSaving(false);
    if (!response.ok) { if (result.error?.code === "INVALID_ORDER_TRANSITION") { router.refresh(); return setError("The order changed in another update. The latest workflow is being loaded."); } return setError(result.error?.message ?? "Could not update this order."); }
    setNote(""); router.refresh();
  }

  return <section className="order-status-form" aria-label="Guided order update">
    <div className="workflow-step"><span>1</span><div><small>RECOMMENDED NEXT STEP</small><b>{labels[selectedStatus] ?? selectedStatus.replaceAll("_", " ")}</b><p>{explanations[selectedStatus] ?? "Confirm this verified order update."}</p></div></div>
    {hasAlternative ? <details className="workflow-alternative"><summary>Choose a different action</summary><label htmlFor={`next-status-${orderId}`}>Use only if the normal step is not correct</label><select id={`next-status-${orderId}`} value={selectedStatus} onChange={(event) => setStatus(event.target.value)}>{allowedStatuses.map((item) => <option key={item} value={item}>{labels[item] ?? item.replaceAll("_", " ")}</option>)}</select></details> : null}
    <label className="workflow-note" htmlFor={`status-note-${orderId}`}><span>2. Customer update note</span><textarea id={`status-note-${orderId}`} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Example: Your parcel is with the courier and will be delivered today." /></label>
    <button className="button primary" disabled={isSaving || !selectedStatus} onClick={save} type="button">{isSaving ? "Saving update…" : `3. Confirm ${labels[selectedStatus] ?? "update"} & notify customer`}</button>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
  </section>;
}
