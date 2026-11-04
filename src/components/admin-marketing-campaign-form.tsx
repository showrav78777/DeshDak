"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type Customer = { id: string; personCode: string; fullName: string; email: string; locale: string; accountType: string };
type Preview = { matchedConsentCount: number; eligibleCount: number; frequencySuppressedCount: number; frequencyHours: number; synchronousRecipientLimit: number };

export function AdminMarketingCampaignForm({ customers }: { customers: Customer[] }) {
  const router = useRouter();
  const key = useRef(crypto.randomUUID());
  const [accountType, setAccountType] = useState("");
  const [locale, setLocale] = useState("");
  const [targetUserId, setTargetUserId] = useState("");
  const [deliveryMode, setDeliveryMode] = useState<"NOW" | "SCHEDULE">("NOW");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ ...(targetUserId ? { targetUserId } : {}), ...(targetUserId ? {} : accountType ? { accountType } : {}), ...(targetUserId ? {} : locale ? { locale } : {}) });
    void fetch(`/api/v1/admin/marketing-campaigns?${query}`, { signal: controller.signal }).then(async (response) => { const result = await response.json(); if (!response.ok) throw new Error(result.error?.message ?? "Preview unavailable."); setPreview(result.data.preview); setPreviewError(""); }).catch((error: unknown) => { if ((error as { name?: string }).name !== "AbortError") { setPreview(null); setPreviewError(error instanceof Error ? error.message : "Preview unavailable."); } });
    return () => controller.abort();
  }, [accountType, locale, targetUserId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage("");
    const form = event.currentTarget;
    if (!preview?.eligibleCount) return setMessage("No opted-in customer is currently eligible.");
    const values = Object.fromEntries(new FormData(form));
    let scheduledFor: string | undefined;
    if (deliveryMode === "SCHEDULE") {
      const selected = new Date(String(values.scheduledFor));
      if (Number.isNaN(selected.getTime())) return setMessage("Choose a valid future delivery time.");
      scheduledFor = selected.toISOString();
    }
    const action = deliveryMode === "SCHEDULE" ? `Schedule this campaign for ${new Date(scheduledFor!).toLocaleString()}? Consent will be checked again when it is delivered.` : `Send this in-app campaign to ${preview.eligibleCount} eligible customer${preview.eligibleCount === 1 ? "" : "s"}?`;
    if (!window.confirm(action)) return;
    setSaving(true);
    const response = await fetch("/api/v1/admin/marketing-campaigns", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key.current }, body: JSON.stringify({ title: values.title, body: values.body, titleBn: values.titleBn || undefined, bodyBn: values.bodyBn || undefined, deepLink: values.deepLink || undefined, scheduledFor, targetUserId: targetUserId || undefined, accountType: targetUserId ? undefined : accountType || undefined, locale: targetUserId ? undefined : locale || undefined }) });
    const result = await response.json(); setSaving(false);
    if (!response.ok) return setMessage(result.error?.message ?? "Campaign could not be saved.");
    key.current = crypto.randomUUID();
    setMessage(result.data.campaign.status === "SCHEDULED" ? `Campaign ${result.data.campaign.campaignCode} scheduled safely.` : `Campaign ${result.data.campaign.campaignCode} delivered in app to ${result.data.campaign.recipientCount} opted-in customer(s).`);
    form.reset(); setAccountType(""); setLocale(""); setTargetUserId(""); setDeliveryMode("NOW"); router.refresh();
  }

  return <section className="marketing-compose"><div className="marketing-compose-head"><div><p className="eyebrow">CONSENT-BASED CAMPAIGN</p><h2>Send or schedule a promotion</h2><p>Only customers who explicitly enabled Marketing · In app are eligible. Scheduled campaigns check consent and the 24-hour frequency limit again at delivery time.</p></div><span>In-app only</span></div><form onSubmit={submit}><fieldset><legend>Audience</legend><label>Specific opted-in customer <span>(optional)</span><select value={targetUserId} onChange={(event) => setTargetUserId(event.target.value)}><option value="">Use audience filters</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.personCode} · {customer.fullName} · {customer.email}</option>)}</select></label><label>Account type<select disabled={Boolean(targetUserId)} value={accountType} onChange={(event) => setAccountType(event.target.value)}><option value="">Personal and business</option><option value="PERSONAL">Personal</option><option value="BUSINESS">Business</option></select></label><label>Profile language<select disabled={Boolean(targetUserId)} value={locale} onChange={(event) => setLocale(event.target.value)}><option value="">English and Bangla</option><option value="en">English</option><option value="bn">Bangla</option></select></label></fieldset><div className="marketing-preview"><div><b>{preview?.eligibleCount ?? "—"}</b><span>eligible now</span></div><div><b>{preview?.matchedConsentCount ?? "—"}</b><span>matched opt-ins</span></div><div><b>{preview?.frequencySuppressedCount ?? "—"}</b><span>frequency suppressed</span></div><small>{previewError || `Maximum ${preview?.synchronousRecipientLimit ?? 1000} recipients per local campaign.`}</small></div><fieldset><legend>Message</legend><label>English title<input name="title" minLength={3} maxLength={120} required /></label><label className="wide">English message<textarea name="body" minLength={10} maxLength={1000} required /></label><label>Bangla title <span>(optional)</span><input name="titleBn" minLength={3} maxLength={120} /></label><label className="wide">Bangla message <span>(optional)</span><textarea name="bodyBn" minLength={10} maxLength={1000} /></label><label className="wide">Public DeshDak link <span>(optional)</span><input name="deepLink" placeholder="/products or /stores/store-name" /><small>Only product, store, help, and trust links are accepted.</small></label></fieldset><fieldset><legend>Delivery time</legend><label>Action<select value={deliveryMode} onChange={(event) => setDeliveryMode(event.target.value as "NOW" | "SCHEDULE")}><option value="NOW">Send now</option><option value="SCHEDULE">Schedule for later</option></select></label>{deliveryMode === "SCHEDULE" ? <label>Local date and time<input name="scheduledFor" required type="datetime-local" /><small>Must be at least five minutes ahead and no more than one year away.</small></label> : null}</fieldset><div className="marketing-channel-row"><label><input checked readOnly type="checkbox" /> In-app delivery</label><label className="unavailable"><input disabled type="checkbox" /> Email after provider connection</label><label className="unavailable"><input disabled type="checkbox" /> SMS / Push / WhatsApp later</label></div>{message ? <p className={message.includes("safely") || message.includes("delivered") ? "form-success" : "form-error"} role="status">{message}</p> : null}<button className="button primary" disabled={saving || !preview?.eligibleCount} type="submit">{saving ? "Saving safely…" : deliveryMode === "SCHEDULE" ? "Review and schedule campaign" : "Review and send campaign"}</button></form></section>;
}
