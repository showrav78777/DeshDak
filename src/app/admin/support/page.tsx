import Link from "next/link";
import { redirect } from "next/navigation";

import { AdminLogoutButton } from "@/components/admin-logout-button";
import { SupportAgentProfileForm, SupportAgentRevokeButton, SupportAgentRoleForm, TicketActionControls } from "@/components/support-forms";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { getServerSession } from "@/lib/server-session";
import { ACTIVE_TICKET_STATUSES, ticketSlaState, ticketStatusLabel } from "@/modules/support/policy";
import "../../support/support.css";
import "./support-admin.css";

export const dynamic = "force-dynamic";

export default async function AdminSupportPage() {
  const session = await getServerSession();
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") redirect("/admin/login");
  // Server-only operational reporting needs a fresh rolling window on every request.
  // eslint-disable-next-line react-hooks/purity
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [tickets, agents, resolvedRecent, qualityReviews, satisfactionRatings] = await Promise.all([
    prisma.ticket.findMany({
      where: { status: { in: ACTIVE_TICKET_STATUSES } },
      include: { customer: { select: { fullName: true, email: true } }, assignedAgent: { select: { id: true, fullName: true } }, order: { select: { orderNumber: true } } },
      orderBy: [{ slaDueAt: "asc" }, { updatedAt: "desc" }],
      take: 100,
    }),
    prisma.user.findMany({
      where: { deletedAt: null, roles: { some: { role: { code: ROLE.CUSTOMER_SERVICE } } } },
      select: { id: true, fullName: true, email: true, status: true, supportAgentProfile: true, _count: { select: { assignedSupportTickets: { where: { status: { in: ACTIVE_TICKET_STATUSES } } } } } },
      orderBy: { fullName: "asc" },
    }),
    prisma.ticket.findMany({ where: { resolvedAt: { gte: thirtyDaysAgo } }, select: { createdAt: true, firstResponseAt: true, resolvedAt: true, slaBreached: true } }),
    prisma.supportQualityReview.findMany({ where: { reviewedAt: { gte: thirtyDaysAgo } }, select: { score: true, outcome: true } }),
    prisma.supportSatisfactionRating.findMany({ where: { submittedAt: { gte: thirtyDaysAgo } }, select: { score: true, issueResolved: true } }),
  ]);
  const breached = tickets.filter((ticket) => ticketSlaState(ticket) === "BREACHED").length;
  const unassigned = tickets.filter((ticket) => !ticket.assignedAgentId).length;
  const agentOptions = agents.filter((agent) => agent.status === "ACTIVE" && (!agent.supportAgentProfile || (agent.supportAgentProfile.availability === "AVAILABLE" && agent.supportAgentProfile.acceptingNewTickets && agent._count.assignedSupportTickets < agent.supportAgentProfile.maxActiveTickets))).map((agent) => ({ id: agent.id, label: `${agent.fullName} · ${agent._count.assignedSupportTickets}/${agent.supportAgentProfile?.maxActiveTickets ?? 20} active` }));
  const respondedRecent = resolvedRecent.filter((ticket) => ticket.firstResponseAt);
  const averageResponseHours = respondedRecent.length ? respondedRecent.reduce((total, ticket) => total + (ticket.firstResponseAt!.getTime() - ticket.createdAt.getTime()) / 3_600_000, 0) / respondedRecent.length : 0;
  const averageResolutionHours = resolvedRecent.length ? resolvedRecent.reduce((total, ticket) => total + (ticket.resolvedAt!.getTime() - ticket.createdAt.getTime()) / 3_600_000, 0) / resolvedRecent.length : 0;
  const breachRate = resolvedRecent.length ? resolvedRecent.filter((ticket) => ticket.slaBreached).length / resolvedRecent.length * 100 : 0;
  const averageQualityScore = qualityReviews.length ? qualityReviews.reduce((total, review) => total + review.score, 0) / qualityReviews.length : 0;
  const coachingRequired = qualityReviews.filter((review) => review.outcome !== "PASS").length;
  const averageSatisfaction = satisfactionRatings.length ? satisfactionRatings.reduce((total, rating) => total + rating.score, 0) / satisfactionRatings.length : 0;
  const customerResolvedRate = satisfactionRatings.length ? satisfactionRatings.filter((rating) => rating.issueResolved).length / satisfactionRatings.length * 100 : 0;
  const followUpRequired = satisfactionRatings.filter((rating) => rating.score <= 2 || !rating.issueResolved).length;
  return <main className="dashboard-shell support-admin-overview">
    <nav className="site-nav"><Link className="brand" href="/admin"><span className="brand-mark">D</span><span>DeshDak Admin</span></Link><div className="customer-nav-account"><Link href="/admin">Control center</Link><span className="dashboard-user">{session.fullName}</span><AdminLogoutButton /></div></nav>
    <section className="admin-content admin-support-content">
      <p className="eyebrow">CUSTOMER SERVICE OPERATIONS</p><h1>Control assignment without losing accountability.</h1><p className="admin-intro">Monitor SLA risk, grant support access to verified staff, and reassign work. Customer Service agents can see personal information only after assignment.</p><Link className="button secondary support-settings-link" href="/admin/support/settings">Operating hours, holidays & rota</Link>
      <aside className="support-admin-guide" aria-label="Support operations steps"><h2>Start here</h2><ol><li>Review deadlines and open the ticket transcript.</li><li>Assign available staff or escalate work that needs attention.</li><li>Set workforce availability and capacity before new assignments.</li></ol><p>Admins oversee assignments and quality. Assigned Customer Service agents publish customer replies and resolutions.</p></aside>
      <div className="support-admin-stats"><article><b>{tickets.length}</b><span>Active tickets</span></article><article className={unassigned ? "warning" : ""}><b>{unassigned}</b><span>Unassigned</span></article><article className={breached ? "danger" : ""}><b>{breached}</b><span>SLA breached</span></article><article><b>{agents.length}</b><span>Support agents</span></article><article><b>{averageResponseHours.toFixed(1)}h</b><span>Avg. first reply · 30d</span></article><article><b>{averageResolutionHours.toFixed(1)}h</b><span>Avg. resolution · 30d</span></article><article className={breachRate ? "warning" : ""}><b>{breachRate.toFixed(0)}%</b><span>SLA breach rate · 30d</span></article><article><b>{averageQualityScore.toFixed(1)}</b><span>Quality score · 30d</span></article><article className={coachingRequired ? "warning" : ""}><b>{coachingRequired}</b><span>Coaching/escalated · 30d</span></article><article><b>{averageSatisfaction.toFixed(1)}</b><span>Customer satisfaction · 30d</span></article><article><b>{customerResolvedRate.toFixed(0)}%</b><span>Customer-confirmed resolved</span></article><article className={followUpRequired ? "danger" : ""}><b>{followUpRequired}</b><span>Feedback follow-up</span></article></div>
      <section className="support-admin-grid">
        <article className="support-panel"><div className="support-panel-head"><div><h2>Active ticket oversight</h2><p>Sorted by response deadline</p></div><span>{tickets.length}</span></div>{tickets.length ? <div className="admin-ticket-list">{tickets.map((ticket) => <article key={ticket.id}>
          <div><small>{ticket.reference} · {ticket.category.replaceAll("_", " ")}</small><Link href={`/admin/support/${ticket.id}`}><b>{ticket.subject}</b></Link><span>{ticket.customer.fullName} · {ticket.customer.email}{ticket.order ? ` · ${ticket.order.orderNumber}` : ""}</span><span>Assigned: {ticket.assignedAgent?.fullName ?? "Nobody"}</span></div>
          <div><em className={`priority-${ticket.priority.toLowerCase()}`}>{ticket.priority}</em><strong>{ticketStatusLabel(ticket.status)}</strong><small className={`sla-${ticketSlaState(ticket).toLowerCase()}`}>{ticketSlaState(ticket).replaceAll("_", " ")} · {ticket.slaDueAt.toLocaleString()}</small><Link className="support-open-link" href={`/admin/support/${ticket.id}`}>Open transcript →</Link><TicketActionControls ticketId={ticket.id} status={ticket.status} priority={ticket.priority} version={ticket.version} agents={agentOptions} oversightOnly /></div>
        </article>)}</div> : <><p className="support-empty-copy">No active support tickets.</p><p className="support-empty-copy">You can review staff availability below or update operating hours and rota.</p></>}</article>
        <article className="support-panel support-workforce-panel"><div className="support-workforce-intro"><div><h2>Customer Service workforce</h2><p>Grant access to an existing verified account, then set availability and capacity. Reassign or finish active tickets before removing access.</p></div><SupportAgentRoleForm /></div><div className="support-agent-list">{agents.map((agent) => <div className="support-agent-row" key={agent.id}><span><b>{agent.fullName}</b><small>{agent.email} · {agent.status}</small><small>{agent.supportAgentProfile?.availability ?? "AVAILABLE"} · {(agent.supportAgentProfile?.languages ?? ["bn", "en"]).join(", ")}</small></span><span className="support-agent-actions"><em>{agent._count.assignedSupportTickets}/{agent.supportAgentProfile?.maxActiveTickets ?? 20} active</em><SupportAgentRevokeButton agentId={agent.id} activeTickets={agent._count.assignedSupportTickets} /></span><SupportAgentProfileForm agentId={agent.id} profile={agent.supportAgentProfile} /></div>)}</div></article>
      </section>
    </section>
  </main>;
}
