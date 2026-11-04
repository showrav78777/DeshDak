"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function ProductReviewForm({ productId, orderItemId, productTitle }: { productId: string; orderItemId: string; productTitle: string }) {
  const router = useRouter();
  const key = useRef<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError("");
    key.current ??= crypto.randomUUID();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const response = await fetch(`/api/v1/catalog/products/${productId}/reviews`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key.current }, body: JSON.stringify({ orderItemId, rating: Number(values.rating), title: values.title, body: values.body }) });
    const result = await response.json(); setSaving(false);
    if (!response.ok) return setError(result.error?.message ?? "Could not submit this review.");
    key.current = null; router.refresh();
  }
  return <form className="product-review-form" onSubmit={submit}><h3>{productTitle}</h3><p>Your verified-purchase review is checked before publication.</p><label>Rating<select name="rating" defaultValue="5" required><option value="5">5 — Excellent</option><option value="4">4 — Good</option><option value="3">3 — Average</option><option value="2">2 — Poor</option><option value="1">1 — Very poor</option></select></label><label>Short title <span>(optional)</span><input name="title" maxLength={120} /></label><label>Review<textarea name="body" minLength={10} maxLength={2000} required /></label>{error ? <p className="form-error" role="alert">{error}</p> : null}<button className="button primary" disabled={saving} type="submit">{saving ? "Submitting…" : "Submit review"}</button></form>;
}
