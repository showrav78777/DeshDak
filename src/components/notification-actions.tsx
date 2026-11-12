"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useClientReady } from "@/components/use-client-ready";

function useNotificationReadAction() {
  const router = useRouter();
  const ready = useClientReady();
  const pending = useRef(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const errorId = useId();
  async function update(path: string, body: object | undefined, confirmed: (data: Record<string, unknown>) => boolean) {
    if (!ready || pending.current || refreshing) return;
    pending.current = true; setSaving(true); setError(""); setMessage("");
    try {
      const response = await fetch(path, {
        method: "PATCH", credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(15_000),
        ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
      });
      const result = await response.json();
      if (!response.ok) { setError(typeof result?.error?.message === "string" ? result.error.message : "Could not update notification read status."); return; }
      if (!result?.data || !confirmed(result.data)) throw new Error("Unconfirmed notification response");
      setMessage("Read status updated."); startRefresh(() => router.refresh());
    } catch {
      setError("Could not confirm the update. Reload to check read status before retrying.");
    } finally { pending.current = false; setSaving(false); }
  }
  return { ready, saving: saving || refreshing, error, message, errorId, update };
}

export function MarkAllNotificationsRead({ disabled }: { disabled: boolean }) {
  const action = useNotificationReadAction();
  return <div className="notification-action" aria-busy={action.saving}>
    <button className="button secondary" disabled={!action.ready || disabled || action.saving} aria-describedby={action.error ? action.errorId : undefined} onClick={() => { if (!disabled) void action.update("/api/v1/notifications", { action: "MARK_ALL_READ" }, data => Number.isSafeInteger(data.updated) && Number(data.updated) >= 0); }} type="button">{action.saving ? "Updating…" : "Mark all as read"}</button>
    {action.error ? <p className="form-error" role="alert" id={action.errorId}>{action.error}</p> : null}
    {action.message ? <small role="status">{action.message}</small> : null}
    <noscript><small>Enable JavaScript to update read status.</small></noscript>
  </div>;
}

export function MarkNotificationRead({ notificationId, read }: { notificationId: string; read: boolean }) {
  const action = useNotificationReadAction();
  if (read) return <span className="notification-read-label">Read</span>;
  return <div className="notification-action" aria-busy={action.saving}>
    <button className="notification-read-button" disabled={!action.ready || action.saving} aria-describedby={action.error ? action.errorId : undefined} onClick={() => void action.update(`/api/v1/notifications/${encodeURIComponent(notificationId)}/read`, undefined, data => data.id === notificationId && typeof data.readAt === "string" && Number.isFinite(Date.parse(data.readAt)))} type="button">{action.saving ? "Saving…" : "Mark read"}</button>
    {action.error ? <p className="form-error" role="alert" id={action.errorId}>{action.error}</p> : null}
    <noscript><small>Enable JavaScript to update read status.</small></noscript>
  </div>;
}
