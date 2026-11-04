import Link from "next/link";
import { redirect } from "next/navigation";
import { InitialAdminSetupForm } from "@/components/initial-admin-setup-form";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function InitialAdminSetupPage() {
  const existingAdmin = await prisma.user.count({ where: { roles: { some: { role: { code: ROLE.ADMIN } } } } });
  if (existingAdmin > 0) redirect("/admin/login");
  return <main className="seller-login-shell"><section className="seller-login-intro"><Link className="brand" href="/"><span className="brand-mark">D</span><span>DeshDak</span></Link><div><p className="eyebrow">SECURE FIRST-TIME SETUP</p><h1>Set up your administrator account.</h1><p>Create the first protected administrator from the browser. Once complete, this setup route automatically closes.</p></div><div className="seller-login-points"><span>✓ One-time use only</span><span>✓ Strong password required</span><span>✓ Human verification enabled</span></div></section><section className="seller-login-card-wrap"><InitialAdminSetupForm /></section></main>;
}
