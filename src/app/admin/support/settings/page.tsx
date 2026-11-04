import Link from "next/link";
import { redirect } from "next/navigation";

import { AdminLogoutButton } from "@/components/admin-logout-button";
import { SupportHolidayForm, SupportPolicyForm, SupportPolicyRemoveButton, SupportShiftForm } from "@/components/support-policy-forms";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { getServerSession } from "@/lib/server-session";
import { getSupportOperatingPolicy } from "@/modules/support/policy";
import "../../../support/support.css";
import "../support-admin.css";

export const dynamic = "force-dynamic";

export default async function SupportSettingsPage() {
  const session = await getServerSession();
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") redirect("/admin/login");
  const [policy, holidays, shifts, agents] = await Promise.all([
    getSupportOperatingPolicy(prisma),
    prisma.supportHoliday.findMany({ orderBy: { date: "asc" }, take: 200 }),
    prisma.supportShift.findMany({ where: { endsAt: { gte: new Date() } }, include: { agent: { select: { fullName: true } } }, orderBy: { startsAt: "asc" }, take: 300 }),
    prisma.user.findMany({ where: { deletedAt: null, status: "ACTIVE", roles: { some: { role: { code: ROLE.CUSTOMER_SERVICE } } } }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } }),
  ]);
  const shiftTime = new Intl.DateTimeFormat("en-GB", { timeZone: policy.timeZone, dateStyle: "medium", timeStyle: "short" });
  return <main className="dashboard-shell support-admin-settings"><nav className="site-nav"><Link className="brand" href="/admin/support"><span className="brand-mark">D</span><span>DeshDak Admin</span></Link><div className="customer-nav-account"><Link href="/admin/support">Support operations</Link><span className="dashboard-user">{session.fullName}</span><AdminLogoutButton /></div></nav><section className="admin-content admin-support-content"><p className="eyebrow">SUPPORT POLICY & ROTA</p><h1>Set support hours and staff coverage.</h1><p className="admin-intro">Configure business days, deadline snapshots, closed dates, and agent shifts from the web application. Every change is validated and audited.</p><aside className="support-admin-guide" aria-label="Calendar setup steps"><h2>Set up in this order</h2><ol><li>Save your timezone, working days and opening hours.</li><li>Add dates when the whole support team is closed.</li><li>Schedule staff coverage, then enable shift-only assignment if needed.</li></ol><p>Changes affect new ticket deadlines. Existing deadlines remain unchanged. Calendar timezone: <strong>{policy.timeZone}</strong>.</p><Link href="/admin/support">← Back to support operations</Link></aside><div className="support-settings-grid"><section className="support-panel"><h2>1. Operating policy</h2><SupportPolicyForm policy={policy} /></section><section className="support-panel"><h2>2. Closed dates</h2><p>Choose full days when support is unavailable, using the calendar timezone.</p><SupportHolidayForm /><div className="support-schedule-list">{!holidays.length ? <p className="support-empty-copy">No closed dates added.</p> : null}{holidays.map((holiday) => <div key={holiday.id}><span><b>{holiday.name}</b><small>{holiday.date.toISOString().slice(0, 10)}</small></span><SupportPolicyRemoveButton path={`/api/v1/admin/support-holidays/${holiday.id}`} label="Remove" /></div>)}</div></section><section className="support-panel support-shift-panel"><h2>3. Agent rota</h2><p>Schedule individual staff coverage. Times below use {policy.timeZone}.</p><SupportShiftForm agents={agents.map((agent) => ({ id: agent.id, label: agent.fullName }))} /><div className="support-schedule-list">{!shifts.length ? <p className="support-empty-copy">No upcoming shifts. Choose an agent and schedule coverage above.</p> : null}{shifts.map((shift) => <div key={shift.id}><span><b>{shift.agent.fullName} · {shift.status}</b><small>{shiftTime.format(shift.startsAt)} → {shiftTime.format(shift.endsAt)}</small>{shift.note ? <small>{shift.note}</small> : null}</span>{shift.status === "SCHEDULED" ? <SupportPolicyRemoveButton path={`/api/v1/admin/support-shifts/${shift.id}`} label="Cancel" /> : null}</div>)}</div></section></div></section></main>;
}
