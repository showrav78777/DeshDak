"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { HumanVerification } from "@/components/human-verification";

export function InspectorLoginForm() {
  const router = useRouter(); const [error, setError] = useState(""); const [submitting, setSubmitting] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setSubmitting(true);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/v1/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...Object.fromEntries(form), portal: "inspector" }) });
    const result = await response.json(); setSubmitting(false);
    if (!response.ok) return setError(result.error?.message ?? "Unable to sign in.");
    router.replace("/inspector"); router.refresh();
  }
  return <form className="seller-login-card warehouse-login-card" onSubmit={submit}><p className="eyebrow">INSPECTOR ACCESS</p><h2>Sign in to quality control</h2><p className="form-help">Only packages at your assigned warehouses and minimum product details are available.</p><label htmlFor="inspectorEmail">Work account email</label><input id="inspectorEmail" name="email" type="email" autoComplete="email" required /><label htmlFor="inspectorPassword">Password</label><input id="inspectorPassword" name="password" type="password" autoComplete="current-password" required /><HumanVerification action="login" />{error ? <p className="form-error" role="alert">{error}</p> : null}<button className="button primary" disabled={submitting} type="submit">{submitting ? "Signing in…" : "Open Inspector Portal"}</button></form>;
}
