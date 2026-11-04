"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { HumanVerification } from "@/components/human-verification";

export function ComplianceLoginForm() {
  const router = useRouter(); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setSaving(true); setError(""); const response = await fetch("/api/v1/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...Object.fromEntries(new FormData(event.currentTarget)), portal: "compliance" }) }); const result = await response.json(); setSaving(false); if (!response.ok) return setError(result.error?.message ?? "Unable to sign in."); router.replace(result.data.nextAction === "SIGNED_IN" ? "/compliance" : "/security/mfa"); router.refresh(); }
  return <form className="seller-login-card" onSubmit={submit}><p className="eyebrow">COMPLIANCE ACCESS</p><h2>Sign in to the review queue</h2><p className="form-help">Only authorized compliance officers with completed MFA can review flagged activity.</p><label htmlFor="complianceEmail">Work account email</label><input id="complianceEmail" name="email" type="email" autoComplete="email" required /><label htmlFor="compliancePassword">Password</label><input id="compliancePassword" name="password" type="password" autoComplete="current-password" required /><HumanVerification action="login" />{error ? <p className="form-error" role="alert">{error}</p> : null}<button className="button primary" disabled={saving} type="submit">{saving ? "Signing in…" : "Continue securely"}</button></form>;
}

export function ComplianceLogoutButton() {
  const [saving, setSaving] = useState(false);
  async function logout() { setSaving(true); try { const response = await fetch("/api/v1/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", cache: "no-store" }); if (!response.ok) throw new Error("LOGOUT_FAILED"); window.location.replace("/"); } catch { setSaving(false); } }
  return <button className="button secondary" disabled={saving} onClick={logout} type="button">{saving ? "Signing out…" : "Sign out"}</button>;
}

export function ComplianceStaffGrantForm() {
  const router = useRouter(); const [saving, setSaving] = useState(false); const [error, setError] = useState(""); const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = event.currentTarget; setSaving(true); setError(""); setMessage(""); const response = await fetch("/api/v1/admin/compliance-staff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(form))) }); const result = await response.json(); setSaving(false); if (!response.ok) return setError(result.error?.message ?? "Unable to grant Compliance access."); setMessage(`Compliance access granted to ${result.data.staff.fullName}.`); form.reset(); router.refresh(); }
  return <form className="compliance-decision" onSubmit={submit}><label>Existing verified account email<input name="email" type="email" placeholder="officer@company.com" required /></label><p className="form-help">The person must first register and verify an account. Their password is never shown or changed.</p><button disabled={saving} type="submit">{saving ? "Granting…" : "Grant Compliance role"}</button>{error ? <small className="form-error" role="alert">{error}</small> : null}{message ? <small className="form-success" role="status">{message}</small> : null}</form>;
}

export function ComplianceStaffRevokeButton({ staffId }: { staffId: string }) {
  const router = useRouter(); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  async function revoke() { if (!window.confirm("Remove Compliance access and revoke every active Compliance session for this person?")) return; setSaving(true); setError(""); const response = await fetch(`/api/v1/admin/compliance-staff/${staffId}`, { method: "DELETE" }); const result = await response.json(); setSaving(false); if (!response.ok) return setError(result.error?.message ?? "Unable to remove Compliance access."); router.refresh(); }
  return <span><button disabled={saving} onClick={revoke} type="button">{saving ? "Removing…" : "Remove access"}</button>{error ? <small className="form-error" role="alert">{error}</small> : null}</span>;
}
