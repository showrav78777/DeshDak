"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ProductRevisionReviewActions({ revisionId, version }: { revisionId: string; version: number }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function review(decision: "APPROVED" | "REJECTED") {
    if (note.trim().length < 3) return setError("Add a short review note first.");
    setError("");
    setIsSubmitting(true);
    const response = await fetch(`/api/v1/admin/product-revisions/${revisionId}/review`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, reviewNote: note, version }) });
    const result = await response.json();
    setIsSubmitting(false);
    if (!response.ok) return setError(result.error?.message ?? "Could not review these changes.");
    router.refresh();
  }

  return <div className="review-actions"><textarea aria-label="Product revision review note" placeholder="Reason or review note" value={note} onChange={(event) => setNote(event.target.value)} /><div><button className="button approve" disabled={isSubmitting} type="button" onClick={() => review("APPROVED")}>Approve changes</button><button className="button reject" disabled={isSubmitting} type="button" onClick={() => review("REJECTED")}>Reject</button></div>{error ? <p className="form-error" role="alert">{error}</p> : null}</div>;
}
