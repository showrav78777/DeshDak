import Link from "next/link";
import { redirect } from "next/navigation";
import { FinanceLoginForm } from "@/components/finance-portal";
import { ROLE } from "@/lib/roles";
import { getServerSession } from "@/lib/server-session";

export default async function FinanceLoginPage() {
  const session = await getServerSession();
  if (session?.roles.includes(ROLE.FINANCE) && session.portal === "finance") redirect("/finance");
  if (session?.identityRoles.includes(ROLE.FINANCE) && session.portal === "finance" && session.mfaRequired && !session.mfaVerifiedAt) redirect("/security/mfa");
  return <main className="seller-login-shell"><section className="seller-login-intro"><Link className="brand" href="/"><span className="brand-mark">D</span><span>DeshDak</span></Link><div><p className="eyebrow">FINANCE PORTAL</p><h1>Controlled money movement.</h1><p>Manage versioned exchange rates and post approved refunds from locked payment evidence.</p></div><div className="seller-login-points"><span>✓ Mandatory MFA</span><span>✓ Double-entry wallet ledger</span><span>✓ Every action audited</span></div></section><section className="seller-login-card-wrap"><FinanceLoginForm /></section></main>;
}
