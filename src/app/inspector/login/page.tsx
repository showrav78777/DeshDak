import Link from "next/link";
import { redirect } from "next/navigation";

import { InspectorLoginForm } from "@/components/inspector-login-form";
import { ROLE } from "@/lib/roles";
import { getServerSession } from "@/lib/server-session";

export default async function InspectorLoginPage() {
  const session = await getServerSession();
  if (session?.portal === "inspector" && session.roles.includes(ROLE.INSPECTOR)) redirect("/inspector");
  return <main className="seller-login-shell warehouse-login-shell"><section className="seller-login-intro"><Link className="brand" href="/"><span className="brand-mark">D</span><span>DeshDak</span></Link><div><p className="eyebrow">FIELD OPERATIONS · INSPECTOR PWA</p><h1>Inspect carefully. Record clearly.</h1><p>Scan received packages, verify condition and quantity, and publish an auditable pass or exception.</p></div><div className="seller-login-points"><span>✓ Assigned warehouse tasks only</span><span>✓ Basic, photo, and video inspection records</span><span>✓ No customer PII, cost, or margin</span></div></section><section className="seller-login-card-wrap"><InspectorLoginForm /></section></main>;
}
