"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function SellerReviewActions({ sellerId }: { sellerId: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function review(decision: "APPROVED" | "REJECTED") {
    if (note.trim().length < 3) return setError("Add a short review note first.");
    setError(""); setIsSubmitting(true);
    const response = await fetch(`/api/v1/admin/sellers/${sellerId}/review`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, reviewNote: note }) });
    const result = await response.json();
    setIsSubmitting(false);
    if (!response.ok) return setError(result.error?.message ?? "Could not save this review.");
    router.refresh();
  }

  return <div className="review-actions"><textarea aria-label="Review note" placeholder="Reason or internal note" value={note} onChange={(event) => setNote(event.target.value)} /><div><button className="button approve" type="button" disabled={isSubmitting} onClick={() => review("APPROVED")}>Approve</button><button className="button reject" type="button" disabled={isSubmitting} onClick={() => review("REJECTED")}>Reject</button></div>{error ? <p className="form-error" role="alert">{error}</p> : null}</div>;
}
