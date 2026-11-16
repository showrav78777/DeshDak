import { redirect } from "next/navigation";
import { CustomerAdminHeader } from "@/components/customer-admin-header";
import { MaintenanceControls } from "@/components/maintenance-controls";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { getServerSession } from "@/lib/server-session";
import { getSecurityCleanupConfiguration, SECURITY_CLEANUP_KEY } from "@/modules/maintenance/security-cleanup";

import { formatSecurityCleanupSummary } from "@/modules/maintenance/security-cleanup-summary";

export const dynamic = "force-dynamic";

export default async function SystemMaintenancePage() {
  const session = await getServerSession();
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin" || !session.mfaVerifiedAt) redirect("/admin/login");
  const [configuration, state, runs] = await Promise.all([getSecurityCleanupConfiguration(), prisma.maintenanceJobState.findUnique({ where: { jobKey: SECURITY_CLEANUP_KEY } }), prisma.maintenanceJobRun.findMany({ where: { jobKey: SECURITY_CLEANUP_KEY }, select: { id: true, triggerSource: true, status: true, startedAt: true, finishedAt: true, summary: true, errorCode: true }, orderBy: { startedAt: "desc" }, take: 20 })]);
  const lockActive = Boolean(state?.lockedUntil && state.lockedUntil > new Date());
  return <main className="dashboard-shell maintenance-shell"><CustomerAdminHeader name={session.fullName} /><section className="admin-content maintenance-page"><p className="eyebrow">SYSTEM MAINTENANCE</p><h1>Protected cleanup operations.</h1><p className="admin-intro">Monitor and control bounded background cleanup without editing source code. Business, financial, customer, and audit records are outside this job’s deletion scope.</p><div className="maintenance-status-grid"><article><span>Last status</span><b>{state?.lastStatus ?? "NOT RUN"}</b><small>{state?.lastFinishedAt?.toLocaleString() ?? "No completed run"}</small></article><article><span>Scheduler secret</span><b>{process.env.MAINTENANCE_JOB_SECRET && process.env.MAINTENANCE_JOB_SECRET.length >= 32 ? "CONFIGURED" : "NOT CONFIGURED"}</b><small>The secret is never displayed or entered in Admin.</small></article><article><span>Concurrency lock</span><b>{lockActive ? "RUNNING" : "AVAILABLE"}</b><small>{lockActive && state?.lockedUntil ? `Protected until ${state.lockedUntil.toLocaleString()}` : "No active job lock"}</small></article></div><MaintenanceControls configuration={configuration} /><section className="maintenance-history"><div className="updates-head"><div><h2>Recent cleanup runs</h2><p>Scheduler and administrator executions remain observable.</p></div><span>{runs.length} record{runs.length === 1 ? "" : "s"}</span></div>{runs.length ? <div className="wallet-table-wrap"><table><thead><tr><th>Started</th><th>Trigger</th><th>Status</th><th>Result</th></tr></thead><tbody>{runs.map((run) => <tr key={run.id}><td>{run.startedAt.toLocaleString()}<small>{run.finishedAt ? `Finished ${run.finishedAt.toLocaleString()}` : "In progress"}</small></td><td>{run.triggerSource}</td><td><span className={run.status === "SUCCEEDED" ? "status-active" : run.status === "FAILED" ? "status-inactive" : ""}>{run.status}</span></td><td><small>{run.errorCode ?? formatSecurityCleanupSummary(run.summary)}</small></td></tr>)}</tbody></table></div> : <div className="dashboard-card"><h2>No cleanup run yet</h2><p>Save the reviewed policy, then use the protected manual control or production scheduler.</p></div>}</section></section></main>;
}
