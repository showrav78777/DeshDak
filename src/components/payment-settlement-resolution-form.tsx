"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type ResolutionType = "CONFIRMED_DUPLICATE" | "PROVIDER_REPORT_ERROR" | "PAYMENT_REFERENCE_CORRECTED" | "CHARGEBACK_CONFIRMED" | "MANUAL_EVIDENCE_ACCEPTED";

export function PaymentSettlementResolutionProposalForm({ entryId }: { entryId: string }) {
  const router = useRouter();
  const [resolutionType, setResolutionType] = useState<ResolutionType>("PROVIDER_REPORT_ERROR");
  const [reason, setReason] = useState("");
  const [evidenceReference, setEvidenceReference] = useState("");
  const [correctedPaymentReference, setCorrectedPaymentReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/v1/finance/payment-reconciliation/${entryId}/proposals`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ resolutionType, reason, evidenceReference, ...(resolutionType === "PAYMENT_REFERENCE_CORRECTED" ? { correctedPaymentReference } : {}) }) });
      const result = await response.json();
      if (!response.ok) return setMessage(result.error?.message ?? "The proposal could not be recorded.");
      setMessage("Proposal recorded. A different Finance or Admin user must review it."); router.refresh();
    } catch { setMessage("The reconciliation service could not be reached."); }
    finally { setBusy(false); }
  }
  return <form className="settlement-resolution-form" onSubmit={submit}><label><span>Proposed resolution</span><select onChange={(event) => setResolutionType(event.target.value as ResolutionType)} value={resolutionType}><option value="PROVIDER_REPORT_ERROR">Provider report error</option><option value="CONFIRMED_DUPLICATE">Confirmed duplicate</option><option value="PAYMENT_REFERENCE_CORRECTED">Correct payment reference</option><option value="CHARGEBACK_CONFIRMED">Confirmed chargeback</option><option value="MANUAL_EVIDENCE_ACCEPTED">Accept verified manual evidence</option></select></label>{resolutionType === "PAYMENT_REFERENCE_CORRECTED" ? <label><span>Corrected DeshDak payment reference</span><input maxLength={100} minLength={3} onChange={(event) => setCorrectedPaymentReference(event.target.value)} required value={correctedPaymentReference} /></label> : null}<label><span>Evidence reference</span><input maxLength={255} minLength={3} onChange={(event) => setEvidenceReference(event.target.value)} placeholder="Merchant report, bank statement or case reference" required value={evidenceReference} /></label><label><span>Reason and evidence checked</span><textarea maxLength={1000} minLength={10} onChange={(event) => setReason(event.target.value)} required value={reason} /></label><button className="button primary" disabled={busy} type="submit">{busy ? "Recording…" : "Propose resolution"}</button>{message ? <p className={message.startsWith("Proposal recorded") ? "form-success" : "form-error"} role="status">{message}</p> : null}</form>;
}

export function PaymentSettlementResolutionDecisionForm({ proposalId, canReview }: { proposalId: string; canReview: boolean }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"APPROVED" | "REJECTED" | null>(null);
  const [message, setMessage] = useState("");
  async function decide(decision: "APPROVED" | "REJECTED") {
    setBusy(decision); setMessage("");
    try {
      const response = await fetch(`/api/v1/finance/payment-reconciliation/proposals/${proposalId}/decision`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ decision, reason }) });
      const result = await response.json();
      if (!response.ok) return setMessage(result.error?.message ?? "The review decision could not be recorded.");
      setMessage(`Resolution ${decision.toLowerCase()} with immutable review evidence.`); router.refresh();
    } catch { setMessage("The reconciliation service could not be reached."); }
    finally { setBusy(null); }
  }
  if (!canReview) return <p className="empty-copy">Independent review required from another Finance or Admin user.</p>;
  return <div className="settlement-decision-form"><label><span>Independent review reason</span><textarea maxLength={1000} minLength={10} onChange={(event) => setReason(event.target.value)} required value={reason} /></label><div><button className="button approve" disabled={Boolean(busy) || reason.trim().length < 10} onClick={() => void decide("APPROVED")} type="button">{busy === "APPROVED" ? "Approving…" : "Approve resolution"}</button><button className="button reject" disabled={Boolean(busy) || reason.trim().length < 10} onClick={() => void decide("REJECTED")} type="button">{busy === "REJECTED" ? "Rejecting…" : "Reject proposal"}</button></div>{message ? <p className={message.startsWith("Resolution") ? "form-success" : "form-error"} role="status">{message}</p> : null}</div>;
}
