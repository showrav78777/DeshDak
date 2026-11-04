import Link from "next/link";
import { redirect } from "next/navigation";
import { SourcingLoginForm } from "@/components/sourcing-portal";
import { ROLE } from "@/lib/roles";
import { getServerSession } from "@/lib/server-session";
import "./sourcing-login.css";

export default async function SourcingLoginPage() { const session = await getServerSession(); if (session?.portal === "sourcing" && session.roles.includes(ROLE.SOURCING_AGENT)) redirect("/sourcing"); return <main className="seller-login-shell"><section className="seller-login-intro"><Link className="brand" href="/"><span className="brand-mark">D</span><span>DeshDak</span></Link><div><p className="eyebrow">SOURCING AGENT PORTAL</p><h1>Prepare accurate product quotes.</h1><p>Review customer-supplied product details and prepare a draft for independent Admin approval.</p></div><div className="seller-login-points"><span>✓ Dedicated least-privilege access</span><span>✓ Customer-visible pricing requires Admin review</span><span>✓ Every draft is audited</span></div></section><section className="seller-login-card-wrap"><SourcingLoginForm /></section></main>; }
