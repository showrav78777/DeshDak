"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useClientReady } from "@/components/use-client-ready";

export function SourcingQuoteForm({ requestId }: { requestId: string }) {
  const ready = useClientReady(); const pending = useRef(false); const router = useRouter();
  const [error, setError] = useState(""); const [isSubmitting, setIsSubmitting] = useState(false); const [submitted, setSubmitted] = useState(false);
  const zone = ready ? Intl.DateTimeFormat().resolvedOptions().timeZone : "your device timezone";
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!ready || pending.current || submitted) return;
    const form = Object.fromEntries(new FormData(event.currentTarget));
    pending.current = true; setError(""); setIsSubmitting(true);
    try {
      const expiry = new Date(String(form.expiresAt));
      if (!Number.isFinite(expiry.getTime()) || expiry <= new Date()) { setError("Choose a future expiry time."); return; }
      const response = await fetch(`/api/v1/sourcing-agent/requests/${requestId}/quote`, { method: "POST", credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(15_000), headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, expiresAt: expiry.toISOString() }) });
      const result = await response.json();
      if (!response.ok) { setError(typeof result?.error?.message === "string" ? `${result.error.message}${response.status === 409 ? " Refresh the queue before submitting again." : ""}` : "Unable to save the draft. Refresh the queue to check its status."); return; }
      const quote = result?.data?.quote;
      if (quote?.status !== "DRAFT" || quote.sourcingRequestId !== requestId || typeof quote.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(quote.id) || !Number.isInteger(quote.version) || quote.version < 1) throw new Error("Unconfirmed draft");
      setSubmitted(true); router.refresh();
    } catch { setError("Could not confirm the draft. Your entries are kept. Refresh the queue to check whether it was saved before submitting again."); }
    finally { pending.current = false; setIsSubmitting(false); }
  }
  const disabled = !ready || isSubmitting || submitted;
  return <form className="quote-form sourcing-draft-form" method="post" aria-busy={isSubmitting} onSubmit={submit}><fieldset disabled={disabled}><legend>Prepare a draft for Admin review</legend><p className="form-help">Enter verified totals for the requested quantity. The customer cannot accept this draft until an independent Admin approves it.</p>{!ready ? <p>Enable JavaScript to submit a draft. No quote has been submitted.</p> : null}<div className="quote-fields"><label>Product cost (BDT)<input name="productCostBdt" type="number" min="1" step="0.01" required /></label><label>Service fee (BDT)<input name="serviceFeeBdt" type="number" min="0" step="0.01" defaultValue="0" required /></label><label>Origin local delivery (BDT)<input name="originDeliveryBdt" type="number" min="0" step="0.01" defaultValue="0" required /><small>Supplier delivery to the origin warehouse.</small></label><label>Estimated international shipping (BDT)<input name="estimatedShippingBdt" type="number" min="0" step="0.01" defaultValue="0" required /><small>Estimate only; the final measured shipping invoice is separate.</small></label><label>Supplier-declared weight (grams)<input name="declaredWeightGrams" type="number" min="1" step="1" required /></label><label>FX rate <span>(optional)</span><input name="fxRate" type="number" min="0.000001" step="0.000001" /></label><label>Expires at<input name="expiresAt" type="datetime-local" aria-describedby={`quote-zone-${requestId}`} required /></label></div><p className="form-help" id={`quote-zone-${requestId}`}>Expiry uses {zone}.</p><label>Quote note <span>(optional)</span><textarea name="note" maxLength={1000} placeholder="Availability, color, timing, or exclusions" /></label>{error ? <p className="form-error" role="alert">{error}</p> : null}{submitted ? <p className="form-success" role="status">Draft saved. Waiting for Admin review.</p> : null}<button className="button primary" type="submit">{isSubmitting ? "Saving…" : "Submit draft for Admin review"}</button>{error ? <button className="button secondary" type="button" onClick={() => router.refresh()}>Refresh queue</button> : null}</fieldset></form>;
}
