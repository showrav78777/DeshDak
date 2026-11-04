"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { useClientReady } from "@/components/use-client-ready";

export function SourcingQuoteReview({ quoteId }: { quoteId: string }) {
  const router = useRouter(); const ready = useClientReady(); const pending = useRef(false);
  const [saving, setSaving] = useState(false); const [error, setError] = useState(""); const [decision, setDecision] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!ready || pending.current || decision) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const action = submitter?.value;
    if (action !== "APPROVE" && action !== "REJECT") { setError("Choose Approve and send or Reject draft to record your decision."); return; }
    const note = String(new FormData(event.currentTarget).get("note") ?? "").trim();
    if (note.length < 5) { setError("Record a review note of at least 5 characters."); return; }
    pending.current = true; setSaving(true); setError("");
    try {
      const response = await fetch(`/api/v1/admin/sourcing-quotes/${quoteId}/review`, { method: "PATCH", credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(15_000), headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, note }) });
      const result = await response.json();
      if (!response.ok) { setError(typeof result?.error?.message === "string" ? `${result.error.message}${response.status === 409 ? " Refresh the review queue before deciding again." : ""}` : "Unable to confirm this review. Refresh the queue to check its status."); return; }
      const quote = result?.data?.quote;
      if (quote?.id !== quoteId || quote.status !== (action === "APPROVE" ? "SENT" : "REJECTED") || typeof quote.reviewedById !== "string" || !quote.reviewedById || typeof quote.reviewedAt !== "string" || !Number.isFinite(Date.parse(quote.reviewedAt))) throw new Error("Unconfirmed review");
      setDecision(action); router.refresh();
    } catch { setError("Could not confirm the review. Your note is kept. Refresh the queue before trying again; the decision may already have saved."); }
    finally { pending.current = false; setSaving(false); }
  }
  return <form className="compliance-decision sourcing-review-form" method="post" aria-busy={saving} onSubmit={submit}><p className="form-help">Check the supplier evidence, total and expiry. Approval sends the quote to the customer. Rejection returns the request to Sourcing for a corrected draft.</p><fieldset disabled={!ready || saving || Boolean(decision)}><label>Admin review note<textarea name="note" minLength={5} maxLength={1000} required placeholder="Record pricing evidence, corrections, or rejection reason." /></label><div className="sourcing-review-actions"><button className="button primary" name="action" value="APPROVE" type="submit">{saving ? "Saving decision…" : "Approve and send"}</button><button className="button secondary" name="action" value="REJECT" type="submit">Reject draft</button></div></fieldset>{error ? <p className="form-error" role="alert">{error}</p> : null}{decision ? <p className="form-success" role="status">{decision === "APPROVE" ? "Quote approved and sent to the customer." : "Draft rejected. Sourcing can prepare a corrected quote."}</p> : null}{error || decision ? <button disabled={saving} className="button secondary" type="button" onClick={() => router.refresh()}>Refresh review queue</button> : null}</form>;
}
