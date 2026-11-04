"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

async function post(url: string, body: object, scope: string) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": `${scope}:${crypto.randomUUID()}` },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error?.message ?? "The request could not be completed.");
  return result;
}

export function PackageServiceRequestForm({ orderId, packages }: { orderId: string; packages: Array<{ id: string; packageCode: string; status: string }> }) {
  const router = useRouter();
  const [type, setType] = useState("CONSOLIDATE");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError("");
    const form = event.currentTarget; const data = new FormData(form);
    try {
      await post("/api/v1/package-services", { orderId, type, packageIds: data.getAll("packageIds"), requestedOutputCount: Number(data.get("requestedOutputCount")), customerNote: data.get("customerNote") }, "package-service");
      form.reset(); router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not request the service."); } finally { setSaving(false); }
  }
  return <form className="warehouse-task-form" onSubmit={submit}>
    <label htmlFor="packageServiceType">Warehouse service</label>
    <select id="packageServiceType" name="type" onChange={(event) => setType(event.target.value)} value={type}><option value="CONSOLIDATE">Combine packages</option><option value="SPLIT">Split one package</option><option value="REPACK">Repack one package</option></select>
    <fieldset><legend>Choose active source package{type === "CONSOLIDATE" ? "s" : ""}</legend>{packages.map((pkg) => <label className="check-row" key={pkg.id}><input name="packageIds" type={type === "CONSOLIDATE" ? "checkbox" : "radio"} value={pkg.id} /><span>{pkg.packageCode} · {pkg.status}</span></label>)}</fieldset>
    <label htmlFor="requestedOutputCount">Number of replacement packages</label>
    <input id="requestedOutputCount" max={10} min={type === "SPLIT" ? 2 : 1} name="requestedOutputCount" readOnly={type !== "SPLIT"} type="number" defaultValue={type === "SPLIT" ? 2 : 1} key={type} />
    <label htmlFor="packageServiceNote">Instructions <span>(optional)</span></label><textarea id="packageServiceNote" maxLength={1000} name="customerNote" placeholder="Tell the team how you want the packages handled." />
    <p className="form-help">Admin must approve this request before Warehouse can act. No service fee is charged by this workflow.</p>
    {error ? <p className="form-error" role="alert">{error}</p> : null}<button className="button primary" disabled={saving} type="submit">{saving ? "Requesting…" : "Request warehouse service"}</button>
  </form>;
}

export function PackageServiceReviewForm({ requestId }: { requestId: string }) {
  const router = useRouter(); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setSaving(true); setError(""); const form = event.currentTarget; const data = new FormData(form); try { await post(`/api/v1/admin/package-services/${requestId}/review`, Object.fromEntries(data), "package-service-review"); router.refresh(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not review this request."); } finally { setSaving(false); } }
  return <form className="warehouse-task-form" onSubmit={submit}><label htmlFor={`serviceAction-${requestId}`}>Decision</label><select id={`serviceAction-${requestId}`} name="action"><option value="APPROVED">Approve for Warehouse</option><option value="REJECTED">Reject request</option></select><label htmlFor={`serviceInternal-${requestId}`}>Internal decision note</label><textarea id={`serviceInternal-${requestId}`} minLength={10} maxLength={1500} name="adminNote" required /><label htmlFor={`serviceCustomer-${requestId}`}>Customer-safe update</label><textarea id={`serviceCustomer-${requestId}`} minLength={3} maxLength={500} name="customerNote" required />{error ? <p className="form-error" role="alert">{error}</p> : null}<button className="button primary" disabled={saving} type="submit">{saving ? "Saving…" : "Save decision"}</button></form>;
}

export function PackageServiceCompleteForm({ requestId, sourcePackageCodes }: { requestId: string; sourcePackageCodes: string[] }) {
  const router = useRouter(); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setSaving(true); setError(""); const form = event.currentTarget; const data = new FormData(form); try { await post(`/api/v1/operations/package-services/${requestId}/complete`, { warehouseNote: data.get("warehouseNote"), scannedPackageCodes: data.getAll("scannedPackageCodes") }, "package-service-complete"); router.refresh(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not complete this warehouse task."); } finally { setSaving(false); } }
  return <form className="warehouse-task-form" onSubmit={submit}><fieldset><legend>Required source scans</legend>{sourcePackageCodes.map((code, index) => <label key={code} htmlFor={`serviceScan-${requestId}-${index}`}>Source {index + 1}: {code}<input autoCapitalize="characters" autoComplete="off" id={`serviceScan-${requestId}-${index}`} name="scannedPackageCodes" pattern="PKG-[A-Fa-f0-9]{12}" placeholder={`Scan ${code}`} required /></label>)}</fieldset><p className="form-help">Each field must be filled from the physical DeshDak package label. Missing, duplicate, extra, or replaced codes are rejected.</p><label htmlFor={`serviceWarehouse-${requestId}`}>Physical handling and label checks</label><textarea id={`serviceWarehouse-${requestId}`} minLength={10} maxLength={1500} name="warehouseNote" placeholder="Confirm handling performed, package count, seal, and replacement labels attached." required />{error ? <p className="form-error" role="alert">{error}</p> : null}<button className="button primary" disabled={saving} type="submit">{saving ? "Creating packages…" : "Complete and create package codes"}</button></form>;
}
