"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useClientReady } from "@/components/use-client-ready";

type Submission = { id: string; documentType: string; issuingCountryCode: string; documentNumberLast4: string; status: string; submittedAt: Date; reviewedAt: Date | null; reviewNote: string | null };

const documentLabels: Record<string, string> = { NATIONAL_ID: "National ID (NID)", PASSPORT: "Passport", DRIVING_LICENSE: "Driving Licence" };

export function IdentityVerificationPanel({ phone, phoneVerifiedAt, kycStatus, submissions, residenceCountryCode }: { phone: string | null; phoneVerifiedAt: Date | null; kycStatus: string; submissions: Submission[]; residenceCountryCode: string }) {
  const router = useRouter();
  const ready = useClientReady();
  const pending = useRef(false);
  const [busy, setBusy] = useState<"phone" | "code" | "identity" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [developmentCode, setDevelopmentCode] = useState("");

  type VerificationResponse = { requested?: boolean; verified?: boolean; expiresAt?: string; developmentCode?: string; submission?: { id?: string; status?: string } };
  async function send(kind: "phone" | "code" | "identity", path: string, init: RequestInit, confirmed: (data: VerificationResponse) => boolean) {
    if (!ready || pending.current) return null;
    pending.current = true; setBusy(kind); setError(""); setMessage(""); setDevelopmentCode("");
    try {
      const response = await fetch(path, { ...init, method: "POST", credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(kind === "identity" ? 30_000 : 15_000) });
      const result = await response.json();
      if (!response.ok) { setError(typeof result?.error?.message === "string" ? result.error.message : "Unable to complete verification."); return null; }
      if (!result?.data || !confirmed(result.data)) throw new Error("Unconfirmed verification response");
      return result.data as VerificationResponse;
    } catch {
      setError("Could not confirm this request. Reload and check your verification status before retrying. Your entered details are kept.");
      return null;
    } finally { pending.current = false; setBusy(null); }
  }

  async function requestPhoneCode() {
    const result = await send("phone", "/api/v1/account/phone-verification/request", {}, data => data.verified === true || (data.requested === true && typeof data.expiresAt === "string" && Number.isFinite(Date.parse(data.expiresAt))));
    if (!result) return;
    if (result.verified) { setMessage("Your phone number is already verified."); router.refresh(); return; }
    setDevelopmentCode(typeof result.developmentCode === "string" && /^\d{6}$/.test(result.developmentCode) ? result.developmentCode : "");
    setMessage("A verification code was requested. Enter it below when it arrives.");
  }
  async function confirmPhoneCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const result = await send("code", "/api/v1/account/phone-verification/confirm", { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: new FormData(form).get("code") }) }, data => data.verified === true);
    if (!result) return;
    form.reset();
    setMessage("Phone number verified successfully."); setDevelopmentCode(""); router.refresh();
  }
  async function submitIdentity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const result = await send("identity", "/api/v1/account/identity-verifications", { body: new FormData(form) }, data => typeof data.submission?.id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.submission.id) && data.submission.status === "PENDING");
    if (!result) return;
    setMessage("Identity verification submitted for Compliance review."); form.reset(); router.refresh();
  }

  return <section className="profile-panel identity-verification-panel"><div className="profile-panel-head"><div><p className="eyebrow">ORDER VERIFICATION</p><h2>Verify phone and identity</h2></div><span>{phoneVerifiedAt && kycStatus === "VERIFIED" ? "READY TO ORDER" : "ACTION REQUIRED"}</span></div><p className="form-help">Complete these two steps once to protect your account and unlock ordering.</p>{!ready ? <p>Enable JavaScript to verify your account. No verification request has been submitted.</p> : null}<div className="identity-status-grid"><article><div className="identity-step-head"><b>1. Verify phone</b><strong className={phoneVerifiedAt ? "identity-ok" : "identity-pending"}>{phoneVerifiedAt ? "Verified" : "Required"}</strong></div><span>{phoneVerifiedAt ? `Verified number · ${phone ?? ""}` : phone ? `Request a code for ${phone}` : "Add a phone number in your profile first."}</span>{!phoneVerifiedAt && phone ? <button className="button secondary" disabled={!ready || busy !== null} onClick={requestPhoneCode} type="button">{busy === "phone" ? "Sending code…" : "Send verification code"}</button> : null}{!phoneVerifiedAt && phone ? <form method="post" encType="multipart/form-data" onSubmit={confirmPhoneCode}><label>Enter the 6-digit code<input disabled={!ready || busy !== null} name="code" inputMode="numeric" maxLength={6} pattern="\d{6}" placeholder="123456" required /></label><button disabled={!ready || busy !== null} type="submit">{busy === "code" ? "Verifying…" : "Verify phone"}</button></form> : null}{developmentCode ? <small className="form-help">Development-only code: <b>{developmentCode}</b></small> : null}</article><article><div className="identity-step-head"><b>2. Upload identity document</b><strong className={kycStatus === "VERIFIED" ? "identity-ok" : "identity-pending"}>{kycStatus.replaceAll("_", " ")}</strong></div>{kycStatus !== "VERIFIED" ? <form method="post" encType="multipart/form-data" onSubmit={submitIdentity}><label>Document type<select disabled={!ready || busy !== null} name="documentType" defaultValue="NATIONAL_ID"><option value="NATIONAL_ID">National ID (NID)</option><option value="PASSPORT">Passport</option><option value="DRIVING_LICENSE">Driving Licence</option></select></label><div className="identity-inline-fields"><label>Issuing country<input disabled={!ready || busy !== null} name="issuingCountryCode" defaultValue={residenceCountryCode} maxLength={2} pattern="[A-Za-z]{2}" required /></label><label>Last 4 characters only<input disabled={!ready || busy !== null} name="documentNumberLast4" maxLength={4} pattern="[A-Za-z0-9]{4}" autoComplete="off" placeholder="AB12" required /></label></div><label>Clear document photo<input disabled={!ready || busy !== null} name="documentPhoto" type="file" accept="image/jpeg,image/png,image/webp" required /></label><small>Upload one clear JPEG, PNG, or WebP photo (maximum 5 MB). Your image is encrypted, is never public, and only Compliance can view it. Do not submit the full document number in the text field.</small><button className="button secondary" disabled={!ready || busy !== null} type="submit">{busy === "identity" ? "Uploading securely…" : "Upload and submit"}</button></form> : <small>Your identity has been approved for ordering.</small>}</article></div>{submissions.length ? <div className="identity-submissions"><b>Identity review history</b>{submissions.map((submission) => <p key={submission.id}><span>{documentLabels[submission.documentType] ?? submission.documentType} · ••••{submission.documentNumberLast4} · {submission.issuingCountryCode}</span><strong>{submission.status}</strong><small>{submission.reviewNote ?? `Submitted ${new Date(submission.submittedAt).toLocaleString("en-GB", { timeZone: "UTC" }) + " UTC"}`}</small></p>)}</div> : null}{error ? <p className="form-error" role="alert">{error}</p> : null}{message ? <p className="form-success" role="status">{message}</p> : null}</section>;
}
