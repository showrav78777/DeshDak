import Link from "next/link";
import { redirect } from "next/navigation";
import { SalesLoginForm } from "@/components/sales-forms";
import { ROLE } from "@/lib/roles";
import { getServerSession } from "@/lib/server-session";

export default async function SalesLoginPage() { const session = await getServerSession(); if (session?.portal === "sales" && session.roles.includes(ROLE.KAM)) redirect("/sales"); return <main className="seller-login-shell"><section className="seller-login-intro"><Link className="brand" href="/"><span className="brand-mark">D</span><span>DeshDak</span></Link><div><p className="eyebrow">SALES AND KEY ACCOUNTS</p><h1>Manage assigned business relationships.</h1><p>Review the customer relationship and record accountable follow-ups without exposing Finance-only or provider information.</p></div><div className="seller-login-points"><span>✓ Assigned accounts only</span><span>✓ Immutable activity history</span><span>✓ Audited access</span></div></section><section className="seller-login-card-wrap"><SalesLoginForm /></section></main>; }
