"use client";

import { useState } from "react";

export function CustomerLogoutButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function logout() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/v1/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("SIGN_OUT_FAILED");
      const result = await response.json() as { data?: { redirectTo?: string } };
      const redirectTo = result.data?.redirectTo;
      window.location.replace(redirectTo === "/" ? redirectTo : "/");
    } catch {
      setLoading(false);
      setError("Sign out failed. Refresh the page and try again.");
    }
  }
  return <><button className="customer-logout" type="button" disabled={loading} onClick={logout}>{loading ? "Signing out…" : "Sign out"}</button>{error ? <small className="form-error" role="alert">{error}</small> : null}</>;
}
