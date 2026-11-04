"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function ProductReviewModeration({ reviewId, version }: { reviewId: string; version: number }) {
  const router = useRouter(); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const response = await fetch(`/api/v1/admin/reviews/${reviewId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision: values.decision, reason: values.reason, version }) });
    const result = await response.json(); setSaving(false);
    if (!response.ok) return setError(result.error?.message ?? "Could not moderate this review.");
    router.refresh();
  }
  return <form className="review-moderation-form" onSubmit={submit}><label>Decision<select name="decision" defaultValue="PUBLISHED"><option value="PUBLISHED">Publish</option><option value="REJECTED">Reject</option></select></label><label>Reason <span>(required for rejection)</span><textarea name="reason" maxLength={500} /></label>{error ? <p className="form-error" role="alert">{error}</p> : null}<button className="button primary" disabled={saving} type="submit">{saving ? "Saving…" : "Apply decision"}</button></form>;
}
