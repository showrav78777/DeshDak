"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useWarehouseReceiptRequest } from "@/components/warehouse-receipt-request";
import { InspectionEvidenceCapture } from "@/components/warehouse-operations";
import { useClientReady } from "@/components/use-client-ready";

async function postForm(url: string, form: HTMLFormElement) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": `warehouse-operation:${crypto.randomUUID()}` }, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message ?? "The operation could not be completed.");
  return result;
}

export function WarehouseLogoutButton() {
  const [loading, setLoading] = useState(false);
  async function logout() { setLoading(true); try { const response = await fetch("/api/v1/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", cache: "no-store" }); if (!response.ok) throw new Error("LOGOUT_FAILED"); window.location.replace("/"); } catch { setLoading(false); } }
  return <button className="warehouse-logout" disabled={loading} onClick={logout} type="button">{loading ? "Signing out…" : "Sign out"}</button>;
}

export function WarehouseReceiveScannedForm({ orderNumber, packageCode, warehouses }: { orderNumber: string; packageCode?: string; warehouses: Array<{ id: string; label: string }> }) {
  const ready = useClientReady();
  const router = useRouter(); const sendReceipt = useWarehouseReceiptRequest(); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!ready || saving) return; setError(""); setSaving(true); try { const result = await sendReceipt(event.currentTarget); router.replace(`/warehouse/packages/${result.data.package.packageCode}`); router.refresh(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not receive package."); setSaving(false); } }
  return <form className="warehouse-task-form" method="post" onSubmit={submit}><input name="orderNumber" type="hidden" value={orderNumber} />{packageCode ? <input name="packageCode" type="hidden" value={packageCode} /> : null}<label htmlFor="scannedWarehouse">Receiving warehouse</label><select id="scannedWarehouse" name="warehouseId" required defaultValue={warehouses.length === 1 ? warehouses[0].id : ""}><option value="">Choose assigned warehouse</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.label}</option>)}</select><label htmlFor="scannedInboundTracking">Inbound tracking <span>(optional)</span></label><input id="scannedInboundTracking" maxLength={120} name="inboundTracking" placeholder="Domestic tracking number" />{error ? <p className="form-error" role="alert">{error}</p> : null}{!ready ? <p className="form-error">Enable JavaScript to confirm receipt. Nothing has been received by this form.</p> : null}<button className="button primary" disabled={!ready || saving} type="submit">{saving ? "Receiving…" : "Confirm package received"}</button></form>;
}

export function WarehousePutAwayForm({ packageId, locations }: { packageId: string; locations: Array<{ id: string; label: string }> }) {
  const router = useRouter(); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setError(""); setSaving(true); try { await postForm(`/api/v1/operations/packages/${packageId}/put-away`, event.currentTarget); router.refresh(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not put away package."); } finally { setSaving(false); } }
  return <form className="warehouse-task-form" onSubmit={submit}><label htmlFor={`location-${packageId}`}>Zone, shelf, bin, or staging area</label><select id={`location-${packageId}`} name="warehouseLocationId" required><option value="">Choose location</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.label}</option>)}</select>{error ? <p className="form-error" role="alert">{error}</p> : null}<button className="button primary" disabled={saving || !locations.length} type="submit">{saving ? "Saving…" : "Confirm put-away"}</button></form>;
}

export function WarehousePackageNoteForm({ packageId }: { packageId: string }) {
  const router = useRouter(); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = event.currentTarget; setError(""); setSaving(true); try { await postForm(`/api/v1/operations/packages/${packageId}/note`, form); form.reset(); router.refresh(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not add note."); } finally { setSaving(false); } }
  return <><form className="warehouse-task-form" onSubmit={submit}><label htmlFor={`note-${packageId}`}>Internal operational note</label><textarea id={`note-${packageId}`} maxLength={500} name="note" placeholder="Packaging condition, handoff, exception, or station note" required />{error ? <p className="form-error" role="alert">{error}</p> : null}<button className="button secondary" disabled={saving} type="submit">{saving ? "Saving…" : "Add timestamped note"}</button></form><InspectionEvidenceCapture packageId={packageId} /></>;
}
