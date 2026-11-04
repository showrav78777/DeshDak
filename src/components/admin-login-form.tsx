"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { HumanVerification } from "@/components/human-verification";
import { useClientReady } from "@/components/use-client-ready";

export function AdminLoginForm() {
  const router = useRouter();
  const ready = useClientReady();
  const pending = useRef(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!ready || pending.current || confirmed) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    pending.current = true; setError(""); setIsSubmitting(true);
    try {
      const response = await fetch("/api/v1/auth/login", { method: "POST", credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(15_000), headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...Object.fromEntries(form), portal: "admin" }) });
      const result = await response.json();
      if (!response.ok) { setError(typeof result?.error?.message === "string" ? result.error.message : "Unable to sign in."); return; }
      const data = result?.data;
      if (!Array.isArray(data?.user?.roles) || !data.user.roles.includes("admin") || !["SIGNED_IN", "MFA_CHALLENGE", "MFA_ENROLLMENT"].includes(data?.nextAction) || typeof data?.session?.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.session.id)) throw new Error("Unconfirmed sign-in");
      setConfirmed(true);
      const password = formElement.elements.namedItem("password");
      if (password instanceof HTMLInputElement) password.value = "";
      router.push(data.nextAction === "SIGNED_IN" ? "/admin" : "/security/mfa"); router.refresh();
    } catch { setError("Could not confirm sign-in. Reload to check your session before trying again. Your entries are kept in this form only."); }
    finally { pending.current = false; setIsSubmitting(false); }
  }
  const disabled = !ready || isSubmitting || confirmed;
  return <form className="seller-login-card" method="post" aria-busy={isSubmitting} onSubmit={handleSubmit}><p className="eyebrow">INTERNAL ACCESS</p><h2>Admin login</h2><p className="form-help">Restricted to authorized platform administrators. Multi-factor verification is required before sensitive work.</p>{!ready ? <p>Enable JavaScript to sign in securely. No credentials have been submitted.</p> : null}<label htmlFor="email">Email</label><input disabled={disabled} id="email" name="email" type="email" autoComplete="email" required /><label htmlFor="password">Password</label><input disabled={disabled} id="password" name="password" type="password" autoComplete="current-password" required /><HumanVerification action="login" />{error ? <p className="form-error" role="alert">{error}</p> : null}<button className="button primary" type="submit" disabled={disabled}>{isSubmitting ? "Signing in…" : "Continue"}</button></form>;
}
