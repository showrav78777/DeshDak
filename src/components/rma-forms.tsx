"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { useClientReady } from "@/components/use-client-ready";

export function RmaCreateForm({ shipmentId, packageIds, trackingNumber, claimDeadline }: { shipmentId: string; packageIds: string[]; trackingNumber: string; claimDeadline: string }) {
  const router = useRouter();
  const ready = useClientReady();
  const pending = useRef(false);
  const attempt = useRef<{ body: string; key: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || pending.current) return;
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const body = JSON.stringify({ shipmentId, packageIds, reason: values.reason, description: values.description, evidenceReferences: [values.evidenceReference] });
    pending.current = true; setSaving(true); setError("");
    try {
      // Reuse the key when retrying an unchanged request after an uncertain response.
      if (attempt.current?.body !== body) attempt.current = { body, key: crypto.randomUUID() };
      const response = await fetch("/api/v1/rmas", { method: "POST", credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(15_000), headers: { "Content-Type": "application/json", "Idempotency-Key": attempt.current.key }, body });
      const result = await response.json();
      if (!response.ok) {
        setError(typeof result?.error?.message === "string" ? result.error.message : "Could not submit this claim.");
        return;
      }
      const id = result?.data?.rma?.id;
      if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error("Unconfirmed claim response");
      router.push(`/rmas/${id}`); router.refresh();
    } catch {
      setError("Could not confirm submission. Check All claims before retrying. Your entered details are kept.");
    } finally { pending.current = false; setSaving(false); }
  }
  return <form className="rma-form" method="post" aria-busy={saving} onSubmit={submit}><div className="rma-form-head"><div><b>Report a problem</b><span>Shipment {trackingNumber}</span></div><small>Deadline {new Date(claimDeadline).toLocaleString("en-GB", { timeZone: "UTC" })} UTC</small></div>{!ready ? <p>Enable JavaScript to submit a claim. No claim has been submitted.</p> : null}<label>What happened?<select disabled={!ready || saving} name="reason" defaultValue="DAMAGED" required><option value="DAMAGED">Significant damage</option><option value="WRONG_ITEM">Wrong product</option><option value="NOT_AS_DESCRIBED">Not as described</option><option value="MISSING_PARTS">Missing parts</option><option value="LOST">Confirmed lost shipment</option><option value="NOT_DELIVERED">Confirmed non-delivery</option></select></label><label>Detailed description<textarea disabled={!ready || saving} name="description" minLength={10} maxLength={2000} required placeholder="Describe the confirmed problem, affected items, and condition." /></label><label>Private evidence reference<input disabled={!ready || saving} name="evidenceReference" pattern="rma-evidence/.+\.(jpg|jpeg|png|webp|mp4|pdf)" maxLength={500} required placeholder="rma-evidence/...jpg" /></label><p className="form-help">Photos or documents must use a private evidence reference. Public cloud links are rejected.</p>{error ? <p className="form-error" role="alert">{error}</p> : null}<button className="button primary" disabled={!ready || saving} type="submit">{saving ? "Submitting…" : "Submit for review"}</button></form>;
}

type ClaimUpdateResponse = { message?: { id?: string; rmaId?: string; body?: string }; rma?: { id?: string; status?: string; returnTrackingNumber?: string } };

function useClaimUpdate() {
  const ready = useClientReady();
  const pending = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  async function save(path: string, body: object, confirmed: (data: ClaimUpdateResponse) => boolean) {
    if (!ready || pending.current) return false;
    pending.current = true; setSaving(true); setError(""); setSaved(false);
    try {
      const response = await fetch(path, { method: "POST", credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(15_000), headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) {
        setError(typeof result?.error?.message === "string" ? result.error.message : "Could not save this update.");
        return false;
      }
      if (!result?.data || !confirmed(result.data)) throw new Error("Unconfirmed update");
      setSaved(true);
      return true;
    } catch {
      setError("Could not confirm this update. Reload and check the conversation or return tracking before retrying to avoid duplicates. Your entered details are kept.");
      return false;
    } finally { pending.current = false; setSaving(false); }
  }
  return { ready, saving, error, saved, save };
}

export function RmaMessageForm({ rmaId }: { rmaId: string }) {
  const router = useRouter();
  const { ready, saving, error, saved, save } = useClaimUpdate();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    const body = String(values.body ?? "").trim();
    const evidence = String(values.evidenceReference ?? "").trim();
    if (await save(`/api/v1/rmas/${rmaId}/messages`, { body, evidenceReferences: evidence ? [evidence] : [] }, data => typeof data.message?.id === "string" && data.message.rmaId === rmaId && data.message.body === body)) { form.reset(); router.refresh(); }
  }
  return <form className="rma-form compact" method="post" aria-busy={saving} onSubmit={submit}>{!ready ? <p>Enable JavaScript to save this update. No update has been submitted.</p> : null}<label>Message<textarea disabled={!ready || saving} name="body" minLength={2} maxLength={2000} required placeholder="Add relevant claim information." /></label><label>Additional private evidence reference <span>(optional)</span><input disabled={!ready || saving} name="evidenceReference" maxLength={500} placeholder="rma-evidence/...jpg" /></label>{saved ? <p role="status">Update saved.</p> : null}{error ? <p className="form-error" role="alert">{error}</p> : null}<button className="button secondary" disabled={!ready || saving} type="submit">{saving ? "Sending…" : "Send update"}</button></form>;
}

export function RmaReturnTrackingForm({ rmaId }: { rmaId: string }) {
  const router = useRouter();
  const { ready, saving, error, saved, save } = useClaimUpdate();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const trackingNumber = String(new FormData(form).get("trackingNumber") ?? "").trim();
    if (await save(`/api/v1/rmas/${rmaId}/return`, { trackingNumber }, data => data.rma?.id === rmaId && data.rma.status === "RETURN_IN_TRANSIT" && data.rma.returnTrackingNumber === trackingNumber)) { form.reset(); router.refresh(); }
  }
  return <form className="rma-form compact" method="post" aria-busy={saving} onSubmit={submit}>{!ready ? <p>Enable JavaScript to save this update. No update has been submitted.</p> : null}<label>Return tracking number<input disabled={!ready || saving} name="trackingNumber" minLength={4} maxLength={120} required /></label>{saved ? <p role="status">Update saved.</p> : null}{error ? <p className="form-error" role="alert">{error}</p> : null}<button className="button primary" disabled={!ready || saving} type="submit">{saving ? "Saving…" : "Confirm return shipment"}</button></form>;
}
