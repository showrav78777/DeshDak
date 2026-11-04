"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type Policy = { expectedParcelAlertHours: number; exceptionResolutionHours: number; storageWarningDays: number };

export function WarehouseExceptionPolicyForm({ policy }: { policy: Policy }) {
  const router = useRouter(); const [saving, setSaving] = useState(false); const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setSaving(true); setMessage(""); const response = await fetch("/api/v1/admin/warehouse-exception-policy", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); const result = await response.json().catch(() => null); setSaving(false); if (!response.ok) return setMessage(result?.error?.message ?? "Could not update policy."); setMessage("Operational thresholds saved and audited."); router.refresh(); }
  return <form className="warehouse-task-form" onSubmit={submit}><div className="two-field"><div><label htmlFor="expectedParcelAlertHours">Expected parcel alert <span>(hours)</span></label><input defaultValue={policy.expectedParcelAlertHours} id="expectedParcelAlertHours" max="2160" min="1" name="expectedParcelAlertHours" type="number" required /></div><div><label htmlFor="exceptionResolutionHours">Exception resolution SLA <span>(hours)</span></label><input defaultValue={policy.exceptionResolutionHours} id="exceptionResolutionHours" max="720" min="1" name="exceptionResolutionHours" type="number" required /></div></div><label htmlFor="storageWarningDays">Warehouse storage warning <span>(days; warning only, never an automatic fee)</span></label><input defaultValue={policy.storageWarningDays} id="storageWarningDays" max="365" min="1" name="storageWarningDays" type="number" required />{message ? <p className={message.startsWith("Operational") ? "form-success" : "form-error"} role="status">{message}</p> : null}<button className="button primary" disabled={saving} type="submit">{saving ? "Saving…" : "Save operational thresholds"}</button></form>;
}
