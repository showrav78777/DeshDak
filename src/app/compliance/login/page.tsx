import Link from "next/link";
import { redirect } from "next/navigation";
import { ComplianceLoginForm } from "@/components/compliance-portal";
import { ROLE } from "@/lib/roles";
import { getServerSession } from "@/lib/server-session";

export default async function ComplianceLoginPage() {
  const session = await getServerSession();
  if (session?.roles.includes(ROLE.COMPLIANCE) && session.portal === "compliance") redirect("/compliance");
  if (session?.identityRoles.includes(ROLE.COMPLIANCE) && session.portal === "compliance" && session.mfaRequired && !session.mfaVerifiedAt) redirect("/security/mfa");
  return <main className="seller-login-shell"><section className="seller-login-intro"><Link className="brand" href="/"><span className="brand-mark">D</span><span>DeshDak</span></Link><div><p className="eyebrow">COMPLIANCE PORTAL</p><h1>Review risk without unnecessary access.</h1><p>Decide flagged screening attempts using documented evidence. Rule creation and platform administration remain separate.</p></div><div className="seller-login-points"><span>✓ Mandatory MFA</span><span>✓ Review-only least privilege</span><span>✓ Every decision audited</span></div></section><section className="seller-login-card-wrap"><ComplianceLoginForm /></section></main>;
}
