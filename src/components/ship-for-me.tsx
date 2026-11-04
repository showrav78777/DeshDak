"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

function mutationKey(prefix: string) { return `${prefix}:${crypto.randomUUID()}`; }

export function ShipForMeRequestForm({ countries }: { countries: Array<{ code: string; name: string }> }) {
  const router = useRouter(); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setSaving(true);
    const form = event.currentTarget; const values = Object.fromEntries(new FormData(form));
    const payload = { ...values, declaredValue: values.declaredValue || undefined, declaredCurrency: values.declaredValue ? values.declaredCurrency : undefined };
    const response = await fetch("/api/v1/ship-for-me/requests", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": mutationKey("ship-for-me-address") }, body: JSON.stringify(payload) });
    const result = await response.json(); setSaving(false);
    if (!response.ok) return setError(result.error?.message ?? "Could not issue a warehouse address.");
    form.reset(); router.refresh();
  }
  return <form className="ship-for-me-form" onSubmit={submit}><label htmlFor="sfmCountry">Source country</label><select id="sfmCountry" name="sourceCountryCode" defaultValue="CN" required>{countries.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}</select><label htmlFor="sfmDescription">What will the seller send?</label><input id="sfmDescription" maxLength={250} name="itemDescription" placeholder="Example: 20 cotton T-shirts" required /><label htmlFor="sfmPackages">Expected parcel count <span>(maximum 10)</span></label><input defaultValue="1" id="sfmPackages" max="10" min="1" name="expectedPackageCount" type="number" required /><div className="two-field"><div><label htmlFor="sfmValue">Declared product value <span>(optional)</span></label><input id="sfmValue" min="0.01" name="declaredValue" step="0.01" type="number" /></div><div><label htmlFor="sfmCurrency">Currency</label><input defaultValue="CNY" id="sfmCurrency" maxLength={3} name="declaredCurrency" /></div></div><label htmlFor="sfmNote">Handling note <span>(optional)</span></label><textarea id="sfmNote" maxLength={1000} name="customerNote" placeholder="Only details the warehouse needs to identify the incoming goods" />{error ? <p className="form-error" role="alert">{error}</p> : null}<button className="button primary" disabled={saving || !countries.length} type="submit">{saving ? "Issuing secure address…" : "Get my warehouse address"}</button></form>;
}

export function ShipForMeTrackingForm({ requestId, expectedPackageCount }: { requestId: string; expectedPackageCount: number }) {
  const router = useRouter(); const [error, setError] = useState(""); const [saving, setSaving] = useState(false); const parcelCount = expectedPackageCount;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setSaving(true); const form = event.currentTarget;
    const values = new FormData(form); const parcels = Array.from({ length: parcelCount }, (_, index) => ({ inboundCarrier: String(values.get(`carrier-${index}`) ?? ""), inboundTracking: String(values.get(`tracking-${index}`) ?? "") }));
    const response = await fetch("/api/v1/ship-for-me/tracking", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": mutationKey("ship-for-me-tracking") }, body: JSON.stringify({ requestId, parcels }) });
    const result = await response.json(); setSaving(false);
    if (!response.ok) return setError(result.error?.message ?? "Could not submit tracking.");
    router.refresh();
  }
  return <form className="ship-for-me-tracking" onSubmit={submit}>{Array.from({ length: parcelCount }, (_, index) => <fieldset key={index}><legend>Parcel {index + 1} of {parcelCount}</legend><label htmlFor={`carrier-${requestId}-${index}`}>Local carrier</label><input id={`carrier-${requestId}-${index}`} maxLength={80} name={`carrier-${index}`} placeholder="Carrier or courier name" required /><label htmlFor={`tracking-${requestId}-${index}`}>Inbound tracking number</label><input autoCapitalize="characters" autoComplete="off" id={`tracking-${requestId}-${index}`} maxLength={120} name={`tracking-${index}`} placeholder="Seller's domestic tracking number" required /></fieldset>)}{error ? <p className="form-error" role="alert">{error}</p> : null}<button className="button primary" disabled={saving} type="submit">{saving ? "Saving tracking…" : `Submit ${parcelCount} parcel tracking number${parcelCount === 1 ? "" : "s"}`}</button></form>;
}

export function CopyWarehouseAddressButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() { try { await navigator.clipboard.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1800); } catch { setCopied(false); } }
  return <button className="button secondary" onClick={copy} type="button">{copied ? "Copied" : "Copy address & reference"}</button>;
}
