"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { HumanVerification } from "@/components/human-verification";

export function InitialAdminSetupForm() {
  const router = useRouter(); const [error, setError] = useState(""); const [isSaving, setIsSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setError(""); setIsSaving(true); const response = await fetch("/api/v1/admin/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); const result = await response.json(); setIsSaving(false); if (!response.ok) return setError(result.error?.message ?? "Could not create the administrator."); router.push("/admin/login"); router.refresh(); }
  return <form className="seller-login-card" onSubmit={submit}><p className="eyebrow">ONE-TIME SETUP</p><h2>Create the first admin</h2><p className="form-help">This page becomes unavailable after the first administrator is created.</p><label htmlFor="adminName">Full name</label><input id="adminName" name="fullName" autoComplete="name" required /><label htmlFor="adminEmail">Admin email</label><input id="adminEmail" name="email" type="email" autoComplete="email" required /><label htmlFor="adminPassword">Password</label><input id="adminPassword" name="password" type="password" minLength={12} autoComplete="new-password" required /><label htmlFor="setupToken">Setup key <span>(required only in production)</span></label><input id="setupToken" name="setupToken" type="password" autoComplete="off" /><HumanVerification action="admin_setup" />{error ? <p className="form-error" role="alert">{error}</p> : null}<button className="button primary" disabled={isSaving} type="submit">{isSaving ? "Creating…" : "Create administrator"}</button></form>;
}
