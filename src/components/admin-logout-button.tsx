"use client";

import { useState } from "react";

export function AdminLogoutButton({ redirectTo: _legacyRedirectTo }: { redirectTo?: string }) {
  // Legacy portal callers may still pass this prop; every successful logout now returns home.
  void _legacyRedirectTo;
  const [loggingOut, setLoggingOut] = useState(false); const [error, setError] = useState("");
  async function logout() { setLoggingOut(true); setError(""); try { const response = await fetch("/api/v1/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", cache: "no-store" }); if (!response.ok) throw new Error("LOGOUT_FAILED"); window.location.replace("/"); } catch { setLoggingOut(false); setError("Logout failed. Please try again."); } }
  return <div className="admin-logout-control"><button disabled={loggingOut} onClick={logout} type="button"><span aria-hidden="true">↪</span>{loggingOut ? "Logging out…" : "Log out"}</button>{error ? <small role="alert">{error}</small> : null}</div>;
}
