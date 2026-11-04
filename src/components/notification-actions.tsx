"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function MarkAllNotificationsRead({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  async function markAll() {
    setSaving(true);
    const response = await fetch("/api/v1/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "MARK_ALL_READ" }) });
    setSaving(false);
    if (response.ok) router.refresh();
  }
  return <button className="button secondary" disabled={disabled || saving} onClick={markAll} type="button">{saving ? "Updating…" : "Mark all as read"}</button>;
}

export function MarkNotificationRead({ notificationId, read }: { notificationId: string; read: boolean }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  if (read) return <span className="notification-read-label">Read</span>;
  async function markRead() {
    setSaving(true);
    const response = await fetch(`/api/v1/notifications/${notificationId}/read`, { method: "PATCH" });
    setSaving(false);
    if (response.ok) router.refresh();
  }
  return <button className="notification-read-button" disabled={saving} onClick={markRead} type="button">{saving ? "Saving…" : "Mark read"}</button>;
}
