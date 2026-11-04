"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { HumanVerification } from "@/components/human-verification";

const subscribeToHydration = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

async function postRecovery(path: string, payload: Record<string, unknown>) {
  const response = await fetch(path, {
    method: "POST", credentials: "same-origin", redirect: "error",
    signal: AbortSignal.timeout(15_000),
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result?.error?.message ?? "Unable to complete the request. Please try again.");
  if (!result?.data || typeof result.data !== "object") throw new Error("Unable to confirm the request. Please try again.");
  return result.data;
}

function useRecoverySubmission() {
  const ready = useSyncExternalStore(subscribeToHydration, clientReady, serverReady);
  const pending = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function run(action: () => Promise<void>) {
    if (!ready || pending.current) return;
    pending.current = true; setSaving(true); setError("");
    try { await action(); }
    catch (failure) { setError(failure instanceof Error && failure.name === "Error" ? failure.message : "Request could not be confirmed. Check your connection and try again."); }
    finally { pending.current = false; setSaving(false); }
  }
  return { ready, saving, error, setError, run };
}

function useFragmentToken() {
  const token = useRef("");
  useEffect(() => {
    function captureToken() {
      const nextToken = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
      if (!nextToken) return;
      token.current = nextToken;
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    }

    captureToken();
    window.addEventListener("hashchange", captureToken);
    return () => window.removeEventListener("hashchange", captureToken);
  }, []);
  return () => token.current;
}

async function confirmDevelopmentVerification(url: string) {
  const token = new URLSearchParams(new URL(url, window.location.origin).hash.slice(1)).get("token");
  if (!token) throw new Error("The local verification link is invalid.");
  await postRecovery("/api/v1/auth/email-verification/confirm", { token });
}

export function PasswordResetRequestForm() {
  const [message, setMessage] = useState(""); const { ready, error, saving, run } = useRecoverySubmission();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget;
    await run(async () => {
      setMessage("");
      const result = await postRecovery("/api/v1/auth/password-reset/request", Object.fromEntries(new FormData(form)));
      if (typeof result.message !== "string") throw new Error("Unable to confirm the request. Please try again.");
      setMessage(result.message); form.reset();
    });
  }
  return <form method="post" className="seller-login-card" onSubmit={submit}><noscript><p className="form-error">Enable JavaScript to use this secure form. No request has been sent.</p></noscript><p className="eyebrow">ACCOUNT RECOVERY</p><h2>Reset your password</h2><p className="form-help">Enter your account email. For privacy, the response is the same whether or not an eligible account exists.</p><label htmlFor="resetEmail">Email</label><input id="resetEmail" name="email" type="email" autoComplete="email" required /><HumanVerification action="password_reset_request" />{error ? <p className="form-error" role="alert">{error}</p> : null}{message ? <p className="form-success" role="status">{message}</p> : null}<button className="button primary" disabled={!ready || saving} type="submit">{saving ? "Requesting…" : "Email secure reset link"}</button><p className="form-footer"><a href="/login">Return to sign in</a></p></form>;
}

export function PasswordResetConfirmForm() {
  const readToken = useFragmentToken(); const { ready, error, setError, saving, run } = useRecoverySubmission();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const token = readToken();
    if (!token) return setError("This password-reset link is missing or invalid. Request a new link.");
    await run(async () => {
      await postRecovery("/api/v1/auth/password-reset/confirm", { ...Object.fromEntries(new FormData(form)), token });
      window.location.replace("/login?reset=1");
    });
  }
  return <form method="post" className="seller-login-card" onSubmit={submit}><noscript><p className="form-error">Enable JavaScript to use this secure form. No request has been sent.</p></noscript><p className="eyebrow">SECURE PASSWORD RESET</p><h2>Create a new password</h2><p className="form-help">Use at least 12 characters. Completing this reset signs out every existing session.</p><label htmlFor="newPassword">New password</label><input id="newPassword" name="password" type="password" minLength={12} maxLength={128} autoComplete="new-password" required /><label htmlFor="confirmPassword">Confirm password</label><input id="confirmPassword" name="confirmPassword" type="password" minLength={12} maxLength={128} autoComplete="new-password" required /><HumanVerification action="password_reset_confirm" />{error ? <p className="form-error" role="alert">{error}</p> : null}<button className="button primary" disabled={!ready || saving} type="submit">{saving ? "Resetting…" : "Reset password and sign out sessions"}</button><p className="form-footer"><a href="/forgot-password">Request another link</a></p></form>;
}

export function EmailVerificationConfirmForm() {
  const readToken = useFragmentToken(); const { ready, error, setError, saving, run } = useRecoverySubmission();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const token = readToken();
    if (!token) return setError("This verification link is missing or invalid. Request a new link.");
    await run(async () => {
      await postRecovery("/api/v1/auth/email-verification/confirm", { ...Object.fromEntries(new FormData(form)), token });
      window.location.replace("/login?verified=1");
    });
  }
  return <form method="post" className="seller-login-card" onSubmit={submit}><noscript><p className="form-error">Enable JavaScript to use this secure form. No request has been sent.</p></noscript><p className="eyebrow">EMAIL VERIFICATION</p><h2>Verify your account</h2><p className="form-help">Confirm the secure link sent to your email. The link is single-use and expires after 24 hours.</p><HumanVerification action="email_verification_confirm" />{error ? <p className="form-error" role="alert">{error}</p> : null}<button className="button primary" disabled={!ready || saving} type="submit">{saving ? "Verifying…" : "Verify email"}</button></form>;
}

export function EmailVerificationRequestForm() {
  const [message, setMessage] = useState(""); const { ready, error, saving, run } = useRecoverySubmission();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget;
    await run(async () => {
      setMessage("");
      const result = await postRecovery("/api/v1/auth/email-verification/request", Object.fromEntries(new FormData(form)));
      if (result.developmentVerificationUrl) {
        await confirmDevelopmentVerification(result.developmentVerificationUrl);
        window.location.replace("/login?verified=1"); return;
      }
      if (typeof result.message !== "string") throw new Error("Unable to confirm the request. Please try again.");
      setMessage(result.message); form.reset();
    });
  }
  return <form method="post" className="seller-login-card" onSubmit={submit}><noscript><p className="form-error">Enable JavaScript to use this secure form. No request has been sent.</p></noscript><h2>Request another link</h2><label htmlFor="verificationEmail">Email</label><input id="verificationEmail" name="email" type="email" autoComplete="email" required /><HumanVerification action="email_verification_request" />{error ? <p className="form-error" role="alert">{error}</p> : null}{message ? <p className="form-success" role="status">{message}</p> : null}<button className="button secondary" disabled={!ready || saving} type="submit">{saving ? "Requesting…" : "Email new verification link"}</button><p className="form-footer"><a href="/login">Return to sign in</a></p></form>;
}
