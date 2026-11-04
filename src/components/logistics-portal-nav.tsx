"use client";

import Link from "next/link";
import { useState } from "react";

export function LogisticsPortalNav({ fullName }: { fullName: string }) {
  const [loading, setLoading] = useState(false);
  async function logout() { setLoading(true); try { const response = await fetch("/api/v1/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", cache: "no-store" }); if (!response.ok) throw new Error("LOGOUT_FAILED"); window.location.replace("/"); } catch { setLoading(false); } }
  return <header className="warehouse-portal-nav logistics-portal-nav"><Link className="brand" href="/logistics"><span className="brand-mark">D</span><span>DeshDak Logistics</span></Link><nav><Link href="/logistics">Shipments</Link><Link className="warehouse-scan-link" href="/logistics/scan">Scan</Link></nav><div><span>{fullName}</span><button className="warehouse-logout" disabled={loading} onClick={logout} type="button">{loading ? "Signing out…" : "Sign out"}</button></div></header>;
}
