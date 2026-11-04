"use client";

import { useRef, useState } from "react";
import { useClientReady } from "@/components/use-client-ready";

export type ManagedSession = {
  id: string;
  portal: string;
  clientName: string;
  clientType: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  revokedAt: string | null;
  isCurrent: boolean;
  isActive: boolean;
};

export function SessionManagement({ initialSessions }: { initialSessions: ManagedSession[] }) {
  const ready = useClientReady();
  const pending = useRef(false);
  const [sessions, setSessions] = useState(initialSessions);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const otherActiveCount = sessions.filter((item) => !item.isCurrent && item.isActive).length;

  async function revokeSession(sessionId: string) {
    if (!ready || pending.current) return;
    pending.current = true;
    setBusy(sessionId); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/v1/auth/sessions/${sessionId}`, { method: "DELETE", credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(15_000) });
      const result = await response.json();
      if (!response.ok) { setError(typeof result?.error?.message === "string" ? result.error.message : "Unable to close that session."); return; }
      if (result?.data?.sessionId !== sessionId || typeof result.data.revokedAt !== "string" || !Number.isFinite(Date.parse(result.data.revokedAt))) throw new Error("Unconfirmed revocation");
      setSessions((current) => current.map((item) => item.id === sessionId ? { ...item, revokedAt: result.data.revokedAt, isActive: false } : item));
      setMessage("The selected session was signed out.");
    } catch { setError("Could not confirm sign-out. Reload this page to check which sessions are still active before retrying."); }
    finally { pending.current = false; setBusy(null); }
  }

  async function revokeOthers() {
    if (!ready || pending.current) return;
    if (!window.confirm("Sign out all other active sessions, including devices not shown in this recent list? This browser stays signed in.")) return;
    pending.current = true;
    setBusy("others"); setError(""); setMessage("");
    try {
      const response = await fetch("/api/v1/auth/sessions/revoke-others", { method: "POST", credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(15_000) });
      const result = await response.json();
      if (!response.ok) { setError(typeof result?.error?.message === "string" ? result.error.message : "Unable to close other sessions."); return; }
      if (!Number.isInteger(result?.data?.revokedCount) || result.data.revokedCount < 0 || result.data.currentSessionId !== sessions.find(item => item.isCurrent)?.id) throw new Error("Unconfirmed revocation");
      const revokedAt = new Date().toISOString();
      setSessions((current) => current.map((item) => !item.isCurrent && item.isActive ? { ...item, revokedAt, isActive: false } : item));
      setMessage(`${result.data.revokedCount} other active session${result.data.revokedCount === 1 ? "" : "s"} signed out.`);
    } catch { setError("Could not confirm sign-out. Reload this page to check which sessions are still active before retrying."); }
    finally { pending.current = false; setBusy(null); }
  }

  return <>
    <p>Showing up to 25 recent sessions. “Sign out all other sessions” also covers active devices not shown here.</p>
    {!ready ? <p>Enable JavaScript to manage sessions. No sign-out request has been submitted.</p> : null}
    <div className="session-security-actions"><div><b>{otherActiveCount}</b><span>other active session{otherActiveCount === 1 ? "" : "s"} shown</span></div><button className="button secondary" disabled={!ready || busy !== null} onClick={revokeOthers} type="button">{busy === "others" ? "Signing out…" : "Sign out all other sessions"}</button></div>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {message ? <p className="form-success" role="status">{message}</p> : null}
    <div className="session-list">{sessions.map((item) => {
      const active = item.isActive;
      return <article className={item.isCurrent ? "current" : ""} key={item.id}><span className="session-device-icon" aria-hidden="true">{item.clientType.includes("MOBILE") ? "▯" : "▣"}</span><div><div className="session-title"><h2>{item.clientName}</h2>{item.isCurrent ? <em>This device</em> : active ? <em className="active">Active</em> : <em>Inactive</em>}</div><p>{item.portal} access · Last active {new Date(item.lastSeenAt).toLocaleString("en-GB", { timeZone: "UTC" }) + " UTC"}</p><small>Signed in {new Date(item.createdAt).toLocaleString("en-GB", { timeZone: "UTC" }) + " UTC"} · Expires {new Date(item.expiresAt).toLocaleString("en-GB", { timeZone: "UTC" }) + " UTC"}</small>{item.revokedAt ? <small>Signed out {new Date(item.revokedAt).toLocaleString("en-GB", { timeZone: "UTC" }) + " UTC"}</small> : null}</div>{!item.isCurrent && active ? <button disabled={!ready || busy !== null} onClick={() => revokeSession(item.id)} type="button">{busy === item.id ? "Signing out…" : "Sign out"}</button> : null}</article>;
    })}</div>
  </>;
}
