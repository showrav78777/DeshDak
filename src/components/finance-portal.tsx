"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { HumanVerification } from "@/components/human-verification";

export function FinanceLoginForm() {
  const router = useRouter(); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setSaving(true); setError(""); const response = await fetch("/api/v1/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...Object.fromEntries(new FormData(event.currentTarget)), portal: "finance" }) }); const result = await response.json(); setSaving(false); if (!response.ok) return setError(result.error?.message ?? "Unable to sign in."); router.replace(result.data.nextAction === "SIGNED_IN" ? "/finance" : "/security/mfa"); router.refresh(); }
  return <form className="seller-login-card" onSubmit={submit}><p className="eyebrow">FINANCE ACCESS</p><h2>Sign in to Finance operations</h2><p className="form-help">Only authorized Finance officers with completed MFA can access rates and approved refunds.</p><label htmlFor="financeEmail">Work account email</label><input id="financeEmail" name="email" type="email" autoComplete="email" required /><label htmlFor="financePassword">Password</label><input id="financePassword" name="password" type="password" autoComplete="current-password" required /><HumanVerification action="login" />{error ? <p className="form-error" role="alert">{error}</p> : null}<button className="button primary" disabled={saving} type="submit">{saving ? "Signing in…" : "Continue securely"}</button></form>;
}

export function FinanceStaffGrantForm() {
  const router = useRouter(); const [saving, setSaving] = useState(false); const [error, setError] = useState(""); const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = event.currentTarget; setSaving(true); setError(""); setMessage(""); const response = await fetch("/api/v1/admin/finance-staff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(form))) }); const result = await response.json(); setSaving(false); if (!response.ok) return setError(result.error?.message ?? "Unable to grant Finance access."); setMessage(`Finance access granted to ${result.data.staff.fullName}.`); form.reset(); router.refresh(); }
  return <form className="compliance-decision" onSubmit={submit}><label>Existing verified account email<input name="email" type="email" placeholder="finance@company.com" required /></label><p className="form-help">The person must already have an active verified account. Passwords are never exposed.</p><button disabled={saving} type="submit">{saving ? "Granting…" : "Grant Finance role"}</button>{error ? <small className="form-error" role="alert">{error}</small> : null}{message ? <small className="form-success" role="status">{message}</small> : null}</form>;
}

export function FinanceStaffRevokeButton({ staffId }: { staffId: string }) {
  const router = useRouter(); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  async function revoke() { if (!window.confirm("Remove Finance access and revoke every active Finance session for this person?")) return; setSaving(true); setError(""); const response = await fetch(`/api/v1/admin/finance-staff/${staffId}`, { method: "DELETE" }); const result = await response.json(); setSaving(false); if (!response.ok) return setError(result.error?.message ?? "Unable to remove Finance access."); router.refresh(); }
  return <span><button disabled={saving} onClick={revoke} type="button">{saving ? "Removing…" : "Remove access"}</button>{error ? <small className="form-error" role="alert">{error}</small> : null}</span>;
}
