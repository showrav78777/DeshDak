import { redirect } from "next/navigation";
import Link from "next/link";
import { AdminLogoutButton } from "@/components/admin-logout-button";
import { AdminMfaForm } from "@/components/admin-mfa-form";
import { getServerSession } from "@/lib/server-session";
import { ROLE } from "@/lib/roles";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function PrivilegedMfaPage() {
  const session = await getServerSession();
  const isAdmin = session?.portal === "admin" && session.identityRoles.includes(ROLE.ADMIN);
  const isCompliance = session?.portal === "compliance" && session.identityRoles.includes(ROLE.COMPLIANCE);
  const isFinance = session?.portal === "finance" && session.identityRoles.includes(ROLE.FINANCE);
  if (!isAdmin && !isCompliance && !isFinance) redirect("/admin/login");
  const continueTo = isCompliance ? "/compliance" : isFinance ? "/finance" : "/admin";
  if (session.mfaVerifiedAt) redirect(continueTo);
  const method = await prisma.mfaMethod.findUnique({ where: { userId: session.userId }, select: { id: true } });
  const audience = isCompliance ? "compliance officer" : isFinance ? "finance officer" : "administrator";
  const loginPath = isCompliance ? "/compliance/login" : isFinance ? "/finance/login" : "/admin/login";
  return <main className="seller-login-shell"><section className="seller-login-intro"><Link className="brand" href="/"><span className="brand-mark">D</span><span>DeshDak</span></Link><div><p className="eyebrow">PRIVILEGED ACCESS SECURITY</p><h1>Protect every sensitive action.</h1><p>{method ? "Confirm this sign-in with your authenticator app or a one-time recovery code." : "Connect an authenticator app before accessing protected operational and customer data."}</p></div><div className="seller-login-points"><span>✓ Encrypted authenticator secret</span><span>✓ Single-use recovery codes</span><span>✓ Challenge lockout and replay protection</span></div></section><section className="seller-login-card-wrap"><AdminMfaForm mode={method ? "challenge" : "enroll"} email={session.email} continueTo={continueTo} audience={audience} /></section><AdminLogoutButton redirectTo={loginPath} /></main>;
}
