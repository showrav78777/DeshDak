"use client";

import { useState, type FormEvent, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { HumanVerification } from "@/components/human-verification";
import { safeInternalPath } from "@/lib/safe-navigation";

async function confirmDevelopmentVerification(url: string) {
  const token = new URLSearchParams(new URL(url, window.location.origin).hash.slice(1)).get("token");
  if (!token) throw new Error("The local verification link is invalid.");
  const response = await fetch("/api/v1/auth/email-verification/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message ?? "Unable to verify this email address.");
}

function GoogleButton({ href, available, mode }: { href: string; available: boolean; mode: "signin" | "signup" }) {
  if (available) return <a className="google-auth-button" href={href}><span aria-hidden="true">G</span>{mode === "signin" ? "Continue with Google" : "Sign up with Google"}</a>;
  return <button className="google-auth-button" disabled title="Google sign-in needs DeshDak's Google OAuth credentials before it can be enabled." type="button"><span aria-hidden="true">G</span>{mode === "signin" ? "Continue with Google" : "Sign up with Google"}<small>Unavailable until configured</small></button>;
}

export function CustomerLoginForm({ nextPath = "/dashboard", notice = "", googleEnabled = false }: { nextPath?: string; notice?: string; googleEnabled?: boolean }) {
  const [error, setError] = useState(""); const [isSubmitting, setIsSubmitting] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if(isSubmitting)return;
    const form=event.currentTarget;setError("");setIsSubmitting(true);let navigating=false;
    try {
      const response=await fetch("/api/v1/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...Object.fromEntries(new FormData(form)),portal:"customer"})});
      const result=await response.json();
      if(!response.ok){setError(result.error?.message??"Unable to sign in.");return;}
      navigating=true;window.location.replace(safeInternalPath(nextPath,"/dashboard"));
    }catch{setError("Sign-in could not be confirmed. Check your connection and try again.");}
    finally{if(!navigating){setIsSubmitting(false);form.dispatchEvent(new Event("deshdak:verification-reset"));}}
  }

  const googleHref = `/api/v1/auth/oauth/google/start?${new URLSearchParams({ mode: "signin", next: safeInternalPath(nextPath, "/dashboard") })}`;
  return <form className="seller-login-card customer-auth-card" onSubmit={submit}><p className="eyebrow">CUSTOMER ACCESS</p><h2>Welcome back</h2><p className="form-help">Sign in to your orders, cart, wallet, sourcing requests, and delivery tracking.</p>{notice ? <p className="form-success" role="status">{notice}</p> : null}<GoogleButton available={googleEnabled} href={googleHref} mode="signin" /><div className="auth-divider"><span>or use email</span></div><label htmlFor="email">Email address</label><input autoFocus id="email" inputMode="email" name="email" type="email" autoComplete="email" required /><label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="current-password" required /><p className="auth-links"><a href="/forgot-password">Forgot password?</a><a href="/verify-email">Verify email</a></p><HumanVerification action="login" />{error ? <p className="form-error" role="alert">{error}</p> : null}<button className="button primary" type="submit" disabled={isSubmitting}>{isSubmitting ? "Signing in…" : "Sign in securely"}</button><p className="form-footer">New to DeshDak? <a href="/register">Create an account</a></p></form>;
}

export function CustomerRegistrationForm({ countries, googleEnabled = false, notice = "" }: { countries: { isoCode: string; name: string }[]; googleEnabled?: boolean; notice?: string }) {
  const router = useRouter(); const [error, setError] = useState(""); const [isSubmitting, setIsSubmitting] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();if(isSubmitting)return;
    const form=event.currentTarget;setError("");setIsSubmitting(true);let created=false;let navigating=false;
    try {
      const response=await fetch("/api/v1/auth/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(Object.fromEntries(new FormData(form)))});
      const result=await response.json();
      if(!response.ok){setError(result.error?.message??"Unable to create account.");return;}
      if(!result.data)throw new Error("Invalid account response");
      created=true;
      if(result.data.developmentVerificationUrl){await confirmDevelopmentVerification(result.data.developmentVerificationUrl);navigating=true;window.location.replace("/login?verified=1");return;}
      router.push("/verify-email?sent=1");
    }catch{setError(created?"Your account was created, but email verification could not finish. Use Verify email from the sign-in page; do not register again.":"Account creation could not be confirmed. Check your email or try signing in before registering again.");}
    finally{if(!navigating){setIsSubmitting(false);form.dispatchEvent(new Event("deshdak:verification-reset"));}}
  }

  function continueWithGoogle(event: MouseEvent<HTMLButtonElement>) { const fields = new FormData(event.currentTarget.form!); const params = new URLSearchParams({ mode: "signup", country: String(fields.get("residenceCountryCode") ?? "BD"), accountType: String(fields.get("accountType") ?? "PERSONAL") }); router.push(`/api/v1/auth/oauth/google/start?${params}`); }
  return <form className="seller-login-card customer-auth-card onboarding-form" onSubmit={submit}><p className="eyebrow">CREATE CUSTOMER ACCOUNT</p><h2>Start shopping</h2><p className="form-help">Use Google for a faster start, or create an email account. You choose your country—DeshDak never guesses it from your IP address.</p>{notice ? <p className="form-success" role="status">{notice}</p> : null}{!googleEnabled ? <><GoogleButton available={false} href="#" mode="signup" /><div className="auth-divider"><span>or create with email</span></div></> : null}<label htmlFor="accountType">Account type</label><select id="accountType" name="accountType" defaultValue="PERSONAL" required><option value="PERSONAL">Personal customer</option><option value="BUSINESS">Business customer</option></select><label htmlFor="fullName">Full name</label><input id="fullName" name="fullName" autoComplete="name" required /><label htmlFor="email">Email address</label><input id="email" name="email" type="email" autoComplete="email" required /><label htmlFor="residenceCountryCode">Country of residence</label><select id="residenceCountryCode" name="residenceCountryCode" defaultValue="BD" autoComplete="country" required>{countries.map((country) => <option key={country.isoCode} value={country.isoCode}>{country.name} ({country.isoCode})</option>)}</select><p className="form-help compact-help">Checkout and shipping routes appear after DeshDak enables them for your country.</p><label htmlFor="phone">Phone number</label><input id="phone" name="phone" type="tel" autoComplete="tel" inputMode="tel" placeholder="Include country code, e.g. +880 or +1" pattern="\+[1-9][0-9 \(\)\-]{7,20}" required /><label htmlFor="password">Create password</label><input id="password" name="password" type="password" minLength={12} maxLength={128} autoComplete="new-password" required /><p className="form-help compact-help">Use at least 12 characters.</p>{googleEnabled ? <button className="google-auth-button google-signup-action" onClick={continueWithGoogle} type="button"><span aria-hidden="true">G</span>Sign up with Google using selected country</button> : null}<HumanVerification action="registration" />{error ? <p className="form-error" role="alert">{error}</p> : null}<button className="button primary" type="submit" disabled={isSubmitting}>{isSubmitting ? "Creating…" : "Create account"}</button><p className="form-footer">Already have an account? <a href="/login">Sign in</a></p></form>;
}
