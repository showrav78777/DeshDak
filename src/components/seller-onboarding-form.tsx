"use client";

import { useState, type FormEvent } from "react";
import { HumanVerification } from "@/components/human-verification";

export function SellerOnboardingForm() {
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(""); setSuccess(""); setIsSubmitting(true);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/v1/seller/onboarding", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(form)) });
    const result = await response.json();
    setIsSubmitting(false);
    if (!response.ok) return setError(result.error?.message ?? "We could not submit the application.");
    event.currentTarget.reset();
    setSuccess("Application received. Verify the secure link sent to your email; administrator review is also required before products can be listed.");
  }

  return <form className="seller-login-card onboarding-form" onSubmit={handleSubmit}>
    <p className="eyebrow">BANGLADESH SELLERS</p><h2>Apply to sell</h2><p className="form-help">Your application is reviewed before your store is activated.</p>
    <label htmlFor="fullName">Your full name</label><input id="fullName" name="fullName" required />
    <label htmlFor="businessName">Business name</label><input id="businessName" name="businessName" required />
    <label htmlFor="storeSlug">Store web address</label><div className="store-slug-field"><span>crossly.com/stores/</span><input id="storeSlug" name="storeSlug" minLength={3} maxLength={60} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="your-store-name" required /></div><p className="field-hint">Use lowercase letters, numbers, and hyphens. This becomes your public worldwide store link.</p>
    <label htmlFor="storeDescription">Tell international customers about your store</label><textarea id="storeDescription" name="storeDescription" minLength={20} maxLength={1000} placeholder="Describe your Bangladesh-made products, experience, and what makes your business special." required />
    <label htmlFor="email">Business email</label><input id="email" name="email" type="email" required />
    <label htmlFor="phone">Phone number</label><input id="phone" name="phone" type="tel" required />
    <label htmlFor="businessAddress">Business address</label><textarea id="businessAddress" name="businessAddress" required />
    <label htmlFor="tradeLicenseNo">Trade licence number <span>(if available)</span></label><input id="tradeLicenseNo" name="tradeLicenseNo" />
    <label htmlFor="nidOrTin">NID or TIN <span>(if available)</span></label><input id="nidOrTin" name="nidOrTin" />
    <label htmlFor="processingDays">Usual preparation time (days)</label><input id="processingDays" name="processingDays" type="number" min="1" max="30" defaultValue="3" required />
    <label className="seller-checkbox" htmlFor="shipsInternationally"><input id="shipsInternationally" name="shipsInternationally" type="checkbox" defaultChecked /><span>I want DeshDak to sell and deliver my products internationally.</span></label>
    <label htmlFor="password">Create password</label><input id="password" name="password" type="password" minLength={12} maxLength={128} autoComplete="new-password" required /><p className="field-hint">Use at least 12 characters.</p>
    <HumanVerification action="seller_onboarding" />
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {success ? <p className="form-success" role="status">{success}</p> : null}
    <button className="button primary" type="submit" disabled={isSubmitting}>{isSubmitting ? "Submitting…" : "Submit application"}</button>
  </form>;
}
