"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type Setup = { secret: string; qrCodeDataUrl: string; expiresAt: string };

export function AdminMfaForm({ mode, email, continueTo = "/admin", audience = "privileged account" }: { mode: "enroll" | "challenge"; email: string; continueTo?: string; audience?: string }) {
  const router = useRouter();
  const started = useRef(false);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (mode !== "enroll" || started.current) return;
    started.current = true;
    void fetch("/api/v1/auth/mfa/setup", { method: "POST" }).then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "Unable to start authenticator setup.");
      setSetup(result.data);
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Unable to start authenticator setup."));
  }, [mode]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setIsSubmitting(true);
    const form = new FormData(event.currentTarget);
    const endpoint = mode === "enroll" ? "/api/v1/auth/mfa/confirm" : "/api/v1/auth/mfa/verify";
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: form.get("code") }) });
      const result = await response.json();
      if (!response.ok) return setError(result.error?.message ?? "Verification failed.");
      if (mode === "enroll") return setRecoveryCodes(result.data.recoveryCodes);
      router.replace(continueTo); router.refresh();
    } catch { setError("Verification could not be confirmed. Check your connection and try again."); }
    finally { setIsSubmitting(false); }
  }

  function downloadRecoveryCodes() {
    const content = [`DeshDak ${audience} recovery codes for ${email}`, "Store these securely. Each code works once.", "", ...recoveryCodes].join("\n");
    const url = URL.createObjectURL(new Blob([content], { type: "text/plain" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "crossly-admin-recovery-codes.txt"; anchor.click(); URL.revokeObjectURL(url);
  }

  if (recoveryCodes.length) return <section className="seller-login-card mfa-card"><p className="eyebrow">SAVE THESE NOW</p><h2>Recovery codes</h2><p className="form-help">These codes are shown only once. Download them and store them somewhere separate from your password.</p><div className="recovery-code-grid" aria-label="One-time recovery codes">{recoveryCodes.map((code) => <code key={code}>{code}</code>)}</div><button className="button secondary" type="button" onClick={downloadRecoveryCodes}>Download recovery codes</button><button className="button primary" type="button" onClick={() => { router.replace(continueTo); router.refresh(); }}>I saved them — continue</button></section>;

  return <form className="seller-login-card mfa-card" onSubmit={submit}><p className="eyebrow">{mode === "enroll" ? "FIRST-TIME SETUP" : "TWO-STEP VERIFICATION"}</p><h2>{mode === "enroll" ? "Connect authenticator" : "Verify it’s you"}</h2>{mode === "enroll" ? <>{setup ? <><p className="form-help">Scan this QR code using Google Authenticator, Microsoft Authenticator, 1Password, or another TOTP app.</p><div className="mfa-qr"><Image src={setup.qrCodeDataUrl} alt="Authenticator setup QR code" width={240} height={240} unoptimized /></div><details className="mfa-manual"><summary>Can’t scan the QR code?</summary><p>Enter this setup key manually:</p><code>{setup.secret}</code></details></> : <p className="form-help">Preparing a secure setup code…</p>}</> : <p className="form-help">Enter the current 6-digit authenticator code. You may also use one unused recovery code.</p>}<label htmlFor="mfa-code">{mode === "enroll" ? "6-digit code" : "Authenticator or recovery code"}</label><input id="mfa-code" name="code" inputMode={mode === "enroll" ? "numeric" : "text"} autoComplete="one-time-code" pattern={mode === "enroll" ? "[0-9]{6}" : undefined} maxLength={mode === "enroll" ? 6 : 32} required disabled={mode === "enroll" && !setup} />{error ? <p className="form-error" role="alert">{error}</p> : null}<button className="button primary" type="submit" disabled={isSubmitting || (mode === "enroll" && !setup)}>{isSubmitting ? "Verifying…" : mode === "enroll" ? "Enable and continue" : "Verify and continue"}</button></form>;
}
