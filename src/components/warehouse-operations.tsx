"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useWarehouseReceiptRequest } from "@/components/warehouse-receipt-request";

type Option = { id: string; label: string };

function EvidenceCaptureInputs({ disabled, onFile }: { disabled: boolean; onFile: (file: File) => void }) {
  const id = useId();
  const [error, setError] = useState("");
  function choose(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
    if (!file) return;
    const video = file.type === "video/mp4";
    if (!["image/jpeg", "image/png", "image/webp", "video/mp4"].includes(file.type)) { setError("Choose a JPEG, PNG, WebP photo or MP4 video."); return; }
    if (!file.size || file.size > (video ? 30 : 8) * 1024 * 1024) { setError(`${video ? "Video" : "Photo"} must be smaller than ${video ? 30 : 8} MB.`); return; }
    setError(""); onFile(file);
  }
  return <fieldset className="evidence-capture-controls" disabled={disabled} aria-busy={disabled}><legend>Capture or choose evidence</legend><p id={`${id}-help`}>Photos: up to 8 MB. MP4 video: up to 30 MB. Check the product is clearly visible and keep personal information out of frame.</p><div className="evidence-capture-options">{[{ key: "photo", text: "Take a photo", accept: "image/jpeg,image/png,image/webp", capture: "environment" as const }, { key: "video", text: "Record a video", accept: "video/mp4", capture: "environment" as const }, { key: "file", text: "Choose from device", accept: "image/jpeg,image/png,image/webp,video/mp4", capture: undefined }].map(option => <label className="evidence-capture-option" key={option.key}><span>{option.text}</span><input aria-label={option.text} aria-describedby={`${id}-help`} type="file" accept={option.accept} capture={option.capture} onChange={choose} /></label>)}</div>{disabled ? <p role="status">Please wait while evidence is saved…</p> : null}{error ? <p className="form-error" role="alert">{error}</p> : null}</fieldset>;
}

function ExistingInspectionEvidence({ packageId, onSelect, disabled }: { packageId: string; disabled?: boolean; onSelect: (reference: string, kind: "PHOTO" | "VIDEO") => void }) {
  const [items, setItems] = useState<Array<{ id: string; mediaKind: "PHOTO" | "VIDEO"; createdAt: string }>>([]);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/v1/operations/packages/${packageId}/inspection-evidence`, { signal: controller.signal }).then(async response => { if (response.ok) setItems((await response.json()).data.evidence); }).catch(() => {});
    return () => controller.abort();
  }, [packageId]);
  return items.length ? <fieldset><legend>Evidence captured by warehouse staff</legend>{items.map(item => <div key={item.id}><a href={`/api/v1/operations/inspection-evidence/${item.id}`} target="_blank" rel="noopener noreferrer">View {item.mediaKind.toLowerCase()}</a> <button type="button" disabled={disabled} onClick={() => onSelect(`inspection-evidence/${item.id}`, item.mediaKind)}>Use this {item.mediaKind.toLowerCase()}</button></div>)}</fieldset> : null;
}

async function postForm(url: string, form: HTMLFormElement) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": `warehouse-operation:${crypto.randomUUID()}` }, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message ?? "The operation could not be completed.");
  return result;
}

export function PackageReceiveForm({ orders, warehouses }: { orders: Option[]; warehouses: Option[] }) {
  const router = useRouter(); const sendReceipt = useWarehouseReceiptRequest(); const [error, setError] = useState(""); const [isSaving, setIsSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = event.currentTarget; setError(""); setIsSaving(true); try { await sendReceipt(form); form.reset(); router.refresh(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not receive package."); } finally { setIsSaving(false); } }
  return <form className="warehouse-operation-form" onSubmit={submit}><label htmlFor="receiveOrder">Supplier-shipped order</label><select id="receiveOrder" name="orderNumber" required><option value="">Choose order</option>{orders.map((order) => <option key={order.id} value={order.id}>{order.label}</option>)}</select><label htmlFor="receiveWarehouse">Origin warehouse</label><select id="receiveWarehouse" name="warehouseId" required><option value="">Choose warehouse</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.label}</option>)}</select><label htmlFor="inboundTracking">Inbound tracking <span>(optional)</span></label><input id="inboundTracking" name="inboundTracking" maxLength={120} placeholder="Domestic tracking number" />{error ? <p className="form-error" role="alert">{error}</p> : null}<button className="button primary" disabled={isSaving || !orders.length || !warehouses.length} type="submit">{isSaving ? "Receiving…" : "Receive & create package"}</button></form>;
}

export function PackageInspectionForm({ packageId }: { packageId: string }) {
  const router = useRouter(); const [error, setError] = useState(""); const [isSaving, setIsSaving] = useState(false); const [mediaReference, setMediaReference] = useState(""); const [mediaKind, setMediaKind] = useState<"PHOTO" | "VIDEO" | null>(null); const [inspectionType, setInspectionType] = useState("BASIC");
  async function upload(file: File) { setError(""); setIsSaving(true); try { const data = new FormData(); data.set("media", file); const response = await fetch(`/api/v1/operations/packages/${packageId}/inspection-evidence`, { method: "POST", body: data }); const result = await response.json(); if (!response.ok) throw new Error(result.error?.message ?? "Could not upload inspection evidence."); setMediaReference(result.data.evidence.reference); setMediaKind(result.data.evidence.mediaKind); setInspectionType(result.data.evidence.mediaKind); } catch (caught) { setMediaReference(""); setMediaKind(null); setError(caught instanceof Error ? caught.message : "Could not upload inspection evidence."); } finally { setIsSaving(false); } }
  const pending = useRef(false);
  const attempt = useRef<{ payload: string; key: string } | null>(null);
  const [completed, setCompleted] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || isSaving || completed) return;
    const fields = new FormData(event.currentTarget);
    const type = String(fields.get("type") ?? "BASIC");
    if (type !== "BASIC" && !mediaReference) { setError("Capture one private photo or video before completing this inspection."); return; }
    if ((type === "PHOTO" && mediaKind === "VIDEO") || (type === "VIDEO" && mediaKind === "PHOTO")) { setError("Choose the matching evidence type before completing inspection."); return; }
    const payload = JSON.stringify({ type, result: fields.get("result"), notes: fields.get("notes"), mediaReference: mediaReference || undefined });
    if (attempt.current?.payload !== payload) attempt.current = { payload, key: `inspection:${crypto.randomUUID()}` };
    pending.current = true; setError(""); setIsSaving(true);
    try {
      const response = await fetch(`/api/v1/operations/packages/${packageId}/inspect`, { method: "POST", credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(15_000), headers: { "Content-Type": "application/json", "Idempotency-Key": attempt.current!.key }, body: payload });
      const result = await response.json();
      if (!response.ok) { setError(result.error?.message ?? "Inspection not confirmed. Refresh and review the package before retrying."); return; }
      if (!result?.data?.inspection?.id) throw new Error("Unconfirmed inspection");
      setCompleted(true); router.refresh();
    } catch { setError("Inspection could not be confirmed; it may already have been saved. Keep the same details to retry safely, or refresh and review the recorded decision."); }
    finally { pending.current = false; setIsSaving(false); }
  }
  return <form className="package-action-form" onSubmit={submit} aria-busy={isSaving}><div className="two-field"><div><label htmlFor={`${packageId}-inspection-type`}>1. Inspection type</label><select id={`${packageId}-inspection-type`} name="type" disabled={isSaving || completed} value={inspectionType} onChange={(event) => setInspectionType(event.target.value)}><option value="BASIC">Basic</option><option value="PHOTO">Photo evidence</option><option value="VIDEO">Video evidence</option></select></div><div><label htmlFor={`${packageId}-inspection-result`}>2. Inspection result</label><select id={`${packageId}-inspection-result`} name="result" disabled={isSaving || completed} defaultValue="PASSED"><option value="PASSED">Passed</option><option value="ATTENTION_REQUIRED">Attention required</option><option value="FAILED">Failed</option></select></div></div><label htmlFor={`${packageId}-inspection-notes`}>3. Inspection notes</label><textarea id={`${packageId}-inspection-notes`} name="notes" disabled={isSaving || completed} maxLength={2000} placeholder="Condition, quantity, packaging, visible damage…" /><ExistingInspectionEvidence disabled={isSaving || completed} packageId={packageId} onSelect={(reference, kind) => { setMediaReference(reference); setMediaKind(kind); setInspectionType(kind); }} /><EvidenceCaptureInputs disabled={isSaving || completed} onFile={(file) => { void upload(file); }} /><p className="form-help">Capture with the device camera or select one image/video. Evidence is private, attached to this package, and shown only to authorised staff and this order’s customer.</p>{mediaReference ? <p className="form-success" role="status">{mediaKind === "VIDEO" ? "Video" : "Photo"} captured securely and ready to attach.</p> : null}{completed ? <p role="status">Inspection saved. Refreshing the recorded task…</p> : null}{error ? <p className="form-error" role="alert">{error}</p> : null}<button className="button primary" disabled={isSaving || completed} type="submit">{completed ? "Inspection saved" : isSaving ? "Saving…" : "Complete inspection"}</button></form>;
}

export function InspectionEvidenceCapture({ packageId }: { packageId: string }) {
  const router = useRouter(); const [error, setError] = useState(""); const [saving, setSaving] = useState(false); const [success, setSuccess] = useState("");
  async function upload(file: File) { setSaving(true); setError(""); setSuccess(""); try { const data = new FormData(); data.set("media", file); const response = await fetch(`/api/v1/operations/packages/${packageId}/inspection-evidence`, { method: "POST", body: data }); const result = await response.json(); if (!response.ok) throw new Error(result.error?.message ?? "Could not upload evidence."); setSuccess(`${result.data.evidence.mediaKind === "VIDEO" ? "Video" : "Photo"} saved for the assigned Inspector.`); router.refresh(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not upload evidence."); } finally { setSaving(false); } }
  return <div className="package-action-form"><EvidenceCaptureInputs disabled={saving} onFile={(file) => { void upload(file); }} /><p className="form-help">Use this only for the physical package. The Inspector remains responsible for the pass/fail decision.</p>{success ? <p className="form-success" role="status">{success}</p> : null}{error ? <p className="form-error" role="alert">{error}</p> : null}</div>;
}

export function PackageMeasurementForm({ packageId }: { packageId: string }) {
  const router = useRouter(); const [error, setError] = useState(""); const [isSaving, setIsSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setError(""); setIsSaving(true); try { await postForm(`/api/v1/operations/packages/${packageId}/measure`, event.currentTarget); router.refresh(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save measurement."); } finally { setIsSaving(false); } }
  return <form className="package-action-form" onSubmit={submit}><div className="measurement-grid"><div><label htmlFor={`${packageId}-actualWeightGrams`}>Actual weight (g)</label><input id={`${packageId}-actualWeightGrams`} name="actualWeightGrams" type="number" inputMode="numeric" step="1" min="1" max="10000000" required /></div><div><label htmlFor={`${packageId}-lengthMm`}>Length (mm)</label><input id={`${packageId}-lengthMm`} name="lengthMm" type="number" inputMode="numeric" step="1" min="1" max="100000" required /></div><div><label htmlFor={`${packageId}-widthMm`}>Width (mm)</label><input id={`${packageId}-widthMm`} name="widthMm" type="number" inputMode="numeric" step="1" min="1" max="100000" required /></div><div><label htmlFor={`${packageId}-heightMm`}>Height (mm)</label><input id={`${packageId}-heightMm`} name="heightMm" type="number" inputMode="numeric" step="1" min="1" max="100000" required /></div></div><p className="form-help">Chargeable weight is calculated automatically using the active shipping lane.</p>{error ? <p className="form-error" role="alert">{error}</p> : null}<button className="button primary" disabled={isSaving} type="submit">{isSaving ? "Calculating…" : "Save measurement"}</button></form>;
}

export function PrintPackageLabelButton({ packageId }: { packageId: string }) {
  const [isPrinting, setIsPrinting] = useState(false); const [error, setError] = useState("");
  async function print() { setIsPrinting(true); setError(""); try { const response = await fetch(`/api/v1/operations/packages/${packageId}/label/print-log`, { method: "POST" }); const result = await response.json(); if (!response.ok) throw new Error(result.error?.message ?? "Print authorization failed."); window.print(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not prepare this label."); } finally { setIsPrinting(false); } }
  return <span className="print-label-control"><button className="print-label-button" disabled={isPrinting} onClick={print} type="button">{isPrinting ? "Preparing…" : "Print 80 mm label"}</button>{error ? <small role="alert">{error}</small> : null}</span>;
}
