"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { HumanVerification } from "@/components/human-verification";
import { useClientReady } from "@/components/use-client-ready";

export function SourcingLoginForm() {
  const ready = useClientReady(); const pending = useRef(false);
  const router = useRouter(); const [saving, setSaving] = useState(false); const [confirmed, setConfirmed] = useState(false); const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!ready || pending.current || confirmed) return;
    const element = event.currentTarget; const form = new FormData(element);
    pending.current = true; setSaving(true); setError("");
    try {
      const response = await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(15_000), headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...Object.fromEntries(form), portal: "sourcing" }) });
      const result = await response.json();
      if (!response.ok) { setError(typeof result?.error?.message === "string" ? result.error.message : "Unable to sign in."); return; }
      const data = result?.data;
      if (data?.nextAction !== "SIGNED_IN" || !Array.isArray(data.user?.roles) || !data.user.roles.includes("sourcing_agent") || typeof data.session?.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.session.id)) throw new Error("Unconfirmed sourcing session");
      setConfirmed(true); const password = element.elements.namedItem("password"); if (password instanceof HTMLInputElement) password.value = "";
      router.replace("/sourcing"); router.refresh();
    } catch { setError("Could not confirm sign-in. Reload to check your session before trying again. Your entries are kept in this form only."); }
    finally { pending.current = false; setSaving(false); }
  }
  const disabled = !ready || saving || confirmed;
  return <form className="seller-login-card sourcing-login-form" method="post" aria-busy={saving} onSubmit={submit}><p className="eyebrow">SOURCING ACCESS</p><h2>Sign in to the sourcing queue</h2><p className="form-help">Authorized agents prepare quote drafts. Admin independently reviews them before customers can see or accept them.</p>{!ready ? <p>Enable JavaScript to sign in securely. No credentials have been submitted.</p> : null}<label htmlFor="sourcingEmail">Work account email</label><input disabled={disabled} id="sourcingEmail" name="email" type="email" autoComplete="email" required /><label htmlFor="sourcingPassword">Password</label><input disabled={disabled} id="sourcingPassword" name="password" type="password" autoComplete="current-password" required /><HumanVerification action="login" />{error ? <p className="form-error" role="alert">{error}</p> : null}<button className="button primary" disabled={disabled} type="submit">{saving ? "Signing in…" : "Sign in securely"}</button></form>;
}

export function SourcingStaffGrantForm() {
  const ready = useClientReady(); const pending = useRef(false); const router = useRouter();
  const [saving, setSaving] = useState(false); const [error, setError] = useState(""); const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!ready || pending.current) return;
    const form = event.currentTarget; const email = String(new FormData(form).get("email") ?? "").trim().toLowerCase();
    pending.current = true; setSaving(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/v1/admin/sourcing-staff", { method: "POST", credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(15_000), headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const result = await response.json();
      if (!response.ok) { setError(typeof result?.error?.message === "string" ? result.error.message : "Unable to grant access. Refresh the workforce to check its status."); return; }
      const staff = result?.data?.staff;
      if (!staff || typeof staff.id !== "string" || !staff.id || staff.email?.toLowerCase() !== email) throw new Error("Unconfirmed grant");
      form.reset(); setMessage(`Sourcing access granted to ${email}.`); router.refresh();
    } catch { setError("Could not confirm access. The email is kept. Refresh the workforce before trying again; the change may already have saved."); }
    finally { pending.current = false; setSaving(false); }
  }
  return <form className="compliance-decision sourcing-staff-form" method="post" aria-busy={saving} onSubmit={submit}><p className="form-help">Use an existing active staff account. This grants the sourcing role only; it does not grant Admin or payment access.</p><fieldset disabled={!ready || saving}><label>Existing verified account email<input name="email" type="email" autoComplete="off" placeholder="agent@company.com" required /></label><button type="submit">{saving ? "Granting…" : "Grant Sourcing Agent role"}</button></fieldset>{error ? <p className="form-error" role="alert">{error}</p> : null}{message ? <p className="form-success" role="status">{message}</p> : null}{error ? <button disabled={saving} type="button" onClick={() => router.refresh()}>Refresh workforce</button> : null}</form>;
}

export function SourcingStaffRevokeButton({ staffId }: { staffId: string }) {
  const ready = useClientReady(); const pending = useRef(false); const router = useRouter();
  const [saving, setSaving] = useState(false); const [removed, setRemoved] = useState(false); const [error, setError] = useState("");
  async function revoke() {
    if (!ready || pending.current || removed || !window.confirm("Remove Sourcing access and revoke all active Sourcing sessions?")) return;
    pending.current = true; setSaving(true); setError("");
    try {
      const response = await fetch(`/api/v1/admin/sourcing-staff/${staffId}`, { method: "DELETE", credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(15_000) });
      const result = await response.json();
      if (!response.ok) { setError(typeof result?.error?.message === "string" ? result.error.message : "Unable to remove access. Refresh the workforce to check its status."); return; }
      if (!result?.data?.staff || !Number.isInteger(result.data.revokedSessions) || result.data.revokedSessions < 0) throw new Error("Unconfirmed removal");
      setRemoved(true); router.refresh();
    } catch { setError("Could not confirm removal. Refresh the workforce before trying again; access may already have been removed."); }
    finally { pending.current = false; setSaving(false); }
  }
  return <div className="sourcing-staff-revoke" aria-busy={saving}><button disabled={!ready || saving || removed} onClick={revoke} type="button">{removed ? "Access removed" : saving ? "Removing…" : "Remove access"}</button>{removed ? <p role="status">Sourcing access and active Sourcing sessions revoked.</p> : null}{error ? <p className="form-error" role="alert">{error}</p> : null}{error ? <button disabled={saving} type="button" onClick={() => router.refresh()}>Refresh workforce</button> : null}</div>;
}
