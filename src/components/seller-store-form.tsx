"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function SellerStoreForm({ initialValues, sellerVersion, readOnly }: { initialValues: { businessName: string; storeDescription: string; processingDays: number }; sellerVersion: number; readOnly: boolean }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (readOnly) return;
    setError(""); setSuccess(""); setIsSubmitting(true);
    const response = await fetch("/api/v1/seller/store", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...Object.fromEntries(new FormData(event.currentTarget)), baseSellerVersion: sellerVersion }) });
    const result = await response.json();
    setIsSubmitting(false);
    if (!response.ok) return setError(result.error?.message ?? "Could not submit store changes.");
    setSuccess("Store changes submitted. Your approved public store remains unchanged until Admin approves them.");
    router.refresh();
  }
  return <form className="seller-store-form" onSubmit={submit}><fieldset disabled={readOnly}><label htmlFor="businessName">Public business name</label><input id="businessName" name="businessName" defaultValue={initialValues.businessName} minLength={2} maxLength={160} required /><label htmlFor="storeDescription">Store description for customers</label><textarea id="storeDescription" name="storeDescription" defaultValue={initialValues.storeDescription} minLength={20} maxLength={1000} required /><label htmlFor="processingDays">Usual product preparation time</label><div className="store-processing-field"><input id="processingDays" name="processingDays" defaultValue={initialValues.processingDays} type="number" min="1" max="30" required /><span>days</span></div></fieldset>{error ? <p className="form-error" role="alert">{error}</p> : null}{success ? <p className="form-success" role="status">{success}</p> : null}{!readOnly ? <button className="button primary" disabled={isSubmitting} type="submit">{isSubmitting ? "Submitting…" : "Submit changes for review"}</button> : null}</form>;
}
