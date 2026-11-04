import { redirect } from "next/navigation";
import { CustomerAdminHeader } from "@/components/customer-admin-header";
import { FinanceStaffGrantForm, FinanceStaffRevokeButton } from "@/components/finance-portal";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { getServerSession } from "@/lib/server-session";

export const dynamic = "force-dynamic";

export default async function AdminFinancePage() {
  const session = await getServerSession();
  if (!session?.roles.includes(ROLE.ADMIN)) redirect("/");
  const staff = await prisma.user.findMany({ where: { deletedAt: null, roles: { some: { role: { code: ROLE.FINANCE } } } }, select: { id: true, personCode: true, fullName: true, email: true, status: true, mfaMethod: { select: { enabledAt: true } }, authSessions: { where: { portal: "finance", revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true } } }, orderBy: { fullName: "asc" } });
  return <main className="dashboard-shell"><CustomerAdminHeader name={session.fullName} /><section className="admin-content"><p className="eyebrow">FINANCE WORKFORCE</p><h1>Finance portal access.</h1><p className="admin-intro">Grant least-privilege Finance access to an existing verified account. MFA is mandatory; revocation immediately closes active Finance sessions.</p><section className="country-list-card"><FinanceStaffGrantForm />{staff.length ? <div className="compliance-rule-list">{staff.map((person) => <article key={person.id}><header><div><b>{person.fullName}</b><span>{person.email} · {person.personCode}</span></div><em className={person.mfaMethod ? "status-active" : "status-inactive"}>{person.mfaMethod ? "MFA READY" : "MFA REQUIRED"}</em></header><p>{person.status} · {person.authSessions.length} active Finance session{person.authSessions.length === 1 ? "" : "s"}</p><FinanceStaffRevokeButton staffId={person.id} /></article>)}</div> : <p className="empty-copy">No Finance officer has been granted access.</p>}</section></section></main>;
}
