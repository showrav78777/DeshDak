import Link from "next/link";
import { redirect } from "next/navigation";

import { SupportLoginForm } from "@/components/support-forms";
import { ROLE } from "@/lib/roles";
import { getServerSession } from "@/lib/server-session";

export default async function SupportLoginPage() {
  const session = await getServerSession();
  if (session?.roles.includes(ROLE.CUSTOMER_SERVICE) && session.portal === "support") redirect("/support/tickets");
  return <main className="seller-login-shell support-login-shell"><section className="seller-login-intro"><Link className="brand" href="/"><span className="brand-mark">D</span><span>DeshDak</span></Link><div><p className="eyebrow">CUSTOMER SERVICE PORTAL</p><h1>Resolve every conversation with context.</h1><p>Work only on assigned customer requests, keep private notes separate, and protect every customer record.</p></div><div className="seller-login-points"><span>✓ Assigned customers only</span><span>✓ SLA and escalation visibility</span><span>✓ Audited replies and decisions</span></div></section><section className="seller-login-card-wrap"><SupportLoginForm /></section></main>;
}
