import Link from "next/link";
import { redirect } from "next/navigation";

import { LogisticsLoginForm } from "@/components/logistics-login-form";
import { ROLE } from "@/lib/roles";
import { getServerSession } from "@/lib/server-session";

export default async function LogisticsLoginPage() {
  const session = await getServerSession();
  if (session?.portal === "logistics" && session.roles.includes(ROLE.LOGISTICS_WORKER)) redirect("/logistics");
  return <main className="seller-login-shell warehouse-login-shell"><section className="seller-login-intro"><Link className="brand" href="/"><span className="brand-mark">D</span><span>DeshDak</span></Link><div><p className="eyebrow">FIELD OPERATIONS · LOGISTICS PWA</p><h1>Scan every handoff. Publish every movement.</h1><p>Create assigned shipments, record controlled tracking transitions, and capture proof of delivery.</p></div><div className="seller-login-points"><span>✓ Assigned warehouse shipments only</span><span>✓ Immutable tracking history</span><span>✓ No customer PII, cost, or margin</span></div></section><section className="seller-login-card-wrap"><LogisticsLoginForm /></section></main>;
}
