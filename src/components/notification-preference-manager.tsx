"use client";

import { useRef, useState } from "react";
import { useClientReady } from "@/components/use-client-ready";

type Preference = { category: string; channel: string; enabled: boolean; locale: string; available: boolean; locked: boolean; deliveryState: string };
const categoryCopy: Record<string, { title: string; body: string }> = {
  TRANSACTIONAL: { title: "Orders and payments", body: "Purchasing, warehouse, shipping, delivery, refund, and support updates." },
  SECURITY: { title: "Account security", body: "Verification, password, session, and important account-protection messages." },
  MARKETING: { title: "Offers and discovery", body: "Optional product, store, and campaign messages. Off by default." },
};
const channelLabels: Record<string, string> = { IN_APP: "In app", EMAIL: "Email", PUSH: "Push", SMS: "SMS", WHATSAPP: "WhatsApp" };

export function NotificationPreferenceManager({ initialItems, locale }: { initialItems: Preference[]; locale: string }) {
  const ready = useClientReady();
  const pending = useRef(false);
  const [error, setError] = useState("");
  const [items, setItems] = useState(initialItems);
  const [saving, setSaving] = useState("");
  const [message, setMessage] = useState("");

  async function change(item: Preference, enabled: boolean) {
    if (!ready || pending.current || item.locked || !item.available) return;
    const key = `${item.category}:${item.channel}`;
    pending.current = true;
    setSaving(key); setMessage(""); setError("");
    try {
      const response = await fetch("/api/v1/notifications/preferences", {
        method: "PATCH", credentials: "same-origin", redirect: "error",
        signal: AbortSignal.timeout(15_000), headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: item.category, channel: item.channel, enabled, locale }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(typeof result?.error?.message === "string" ? result.error.message : "Could not update this preference.");
        return;
      }
      const saved = result?.data?.preference;
      if (!saved || saved.category !== item.category || saved.channel !== item.channel || saved.enabled !== enabled || saved.locale !== locale || typeof saved.available !== "boolean" || typeof saved.locked !== "boolean" || !["ACTIVE", "QUEUED_UNTIL_PROVIDER", "NOT_AVAILABLE"].includes(saved.deliveryState)) throw new Error("Unconfirmed preference response");
      setItems(current => current.map(entry => entry.category === item.category && entry.channel === item.channel ? { ...entry, enabled: saved.enabled, locale: saved.locale, available: saved.available, locked: saved.locked, deliveryState: saved.deliveryState } : entry));
      setMessage("Notification preference saved.");
    } catch {
      setError("Could not confirm the change. Reload to check your saved preferences before retrying.");
    } finally {
      pending.current = false; setSaving("");
    }
  }

  const emailLive = items.some((item) => item.channel === "EMAIL" && item.deliveryState === "ACTIVE");
  return <section className="notification-preferences" aria-busy={Boolean(saving)}><div className="notification-preferences-head"><div><p className="eyebrow">DELIVERY SETTINGS</p><h2>Choose how DeshDak contacts you.</h2><p>{emailLive ? "In-app and email delivery are active. You can change optional preferences below." : "In-app delivery works now. Essential security emails remain queued until email delivery is connected. Optional email preferences become available after setup."}</p></div><span>Language: {locale === "bn" ? "বাংলা" : "English"}</span></div>{!ready ? <p className="form-help">Enable JavaScript to change notification settings. Your saved preferences are shown below.</p> : null}{error ? <p className="form-error" role="alert">{error}</p> : null}{message ? <p className="form-success" role="status">{message}</p> : null}<div className="notification-preference-groups">{Object.entries(categoryCopy).map(([category, copy]) => <article key={category}><header><div><h3>{copy.title}</h3><p>{copy.body}</p></div>{category === "MARKETING" ? <span>Optional</span> : <span>Essential</span>}</header><div>{items.filter((item) => item.category === category).map((item) => { const unavailable = !item.available; return <label className={unavailable ? "unavailable" : ""} key={item.channel}><span><b>{channelLabels[item.channel]}</b><small>{item.locked ? "Always on for account safety" : item.deliveryState === "ACTIVE" ? "Available now" : item.deliveryState === "QUEUED_UNTIL_PROVIDER" ? "Email provider connection required" : "Coming after provider setup"}</small></span><input aria-label={`${copy.title} by ${channelLabels[item.channel]}`} checked={item.enabled} disabled={!ready || item.locked || unavailable || Boolean(saving)} onChange={(event) => change(item, event.target.checked)} type="checkbox" /></label>; })}</div></article>)}</div><small className="notification-language-note">Message language follows your Profile setting. Essential security and in-app transaction messages cannot be disabled.</small></section>;
}
