"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { HumanVerification } from "@/components/human-verification";

export function SellerLoginForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/v1/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...Object.fromEntries(form), portal: "seller" }) });
    const result = await response.json();
    setIsSubmitting(false);
    if (!response.ok) return setError(result.error?.message ?? "Unable to sign in.");
    router.push("/seller/dashboard");
    router.refresh();
  }

  return <form className="seller-login-card" onSubmit={handleSubmit}>
    <p className="eyebrow">WELCOME BACK</p><h2>Seller login</h2><p className="form-help">Use your approved seller account to continue.</p>
    <label htmlFor="email">Business email</label><input id="email" name="email" type="email" autoComplete="email" placeholder="you@business.com" required />
    <label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="current-password" placeholder="Enter your password" required />
    <p className="form-help"><a href="/forgot-password">Forgot password?</a></p>
    <HumanVerification action="login" />
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <button className="button primary" type="submit" disabled={isSubmitting}>{isSubmitting ? "Signing in…" : "Continue to seller portal"}</button>
    <p className="form-footer">New seller? <a href="/seller/apply">Request onboarding</a></p>
  </form>;
}
