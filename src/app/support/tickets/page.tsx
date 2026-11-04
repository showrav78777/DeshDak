import Link from "next/link";
import { redirect } from "next/navigation";

import { SupportLogoutButton, TicketActionControls } from "@/components/support-forms";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { getServerSession } from "@/lib/server-session";
import { ACTIVE_TICKET_STATUSES, ticketSlaState, ticketStatusLabel } from "@/modules/support/policy";

export const dynamic = "force-dynamic";

export default async function SupportQueuePage() {
  const session = await getServerSession();
  if (!session?.roles.includes(ROLE.CUSTOMER_SERVICE) || session.portal !== "support") redirect("/support/login");
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const qualityWindow = new Date();
  qualityWindow.setDate(qualityWindow.getDate() - 30);
  const [profile, mine, unassigned, resolvedToday, qualityReviews, satisfactionRatings] = await Promise.all([
    prisma.supportAgentProfile.findUnique({ where: { userId: session.userId } }),
    prisma.ticket.findMany({ where: { assignedAgentId: session.userId, status: { in: ACTIVE_TICKET_STATUSES } }, include: { customer: { select: { fullName: true, accountType: true } }, order: { select: { orderNumber: true } }, conversation: { select: { lastMessageAt: true } } }, orderBy: [{ slaDueAt: "asc" }, { updatedAt: "desc" }], take: 100 }),
    prisma.ticket.findMany({ where: { assignedAgentId: null, status: { in: ACTIVE_TICKET_STATUSES } }, include: { customer: { select: { accountType: true } }, order: { select: { orderNumber: true } } }, orderBy: [{ priority: "desc" }, { slaDueAt: "asc" }], take: 50 }),
    prisma.ticket.count({ where: { assignedAgentId: session.userId, resolvedAt: { gte: startOfToday } } }),
    prisma.supportQualityReview.findMany({ where: { agentId: session.userId, reviewedAt: { gte: qualityWindow } }, select: { score: true, outcome: true } }),
    prisma.supportSatisfactionRating.findMany({ where: { agentId: session.userId, submittedAt: { gte: qualityWindow } }, select: { score: true, issueResolved: true } }),
  ]);
  const breached = mine.filter((ticket) => ticketSlaState(ticket) === "BREACHED").length;
  const waiting = mine.filter((ticket) => ticket.status === "WAITING_FOR_CUSTOMER").length;
  const qualityScore = qualityReviews.length ? qualityReviews.reduce((total, review) => total + review.score, 0) / qualityReviews.length : 0;
  const coaching = qualityReviews.filter((review) => review.outcome !== "PASS").length;
  const satisfactionScore = satisfactionRatings.length ? satisfactionRatings.reduce((total, rating) => total + rating.score, 0) / satisfactionRatings.length : 0;
  const customerResolvedRate = satisfactionRatings.length ? satisfactionRatings.filter((rating) => rating.issueResolved).length / satisfactionRatings.length * 100 : 0;
  const availability = profile?.availability ?? "AVAILABLE";
  const accepting = profile?.acceptingNewTickets ?? true;
  const capacity = profile?.maxActiveTickets ?? 20;

  return <main className="support-portal">
    <nav className="support-portal-nav"><Link className="brand" href="/support/tickets"><span className="brand-mark">D</span><span>DeshDak CS</span></Link><div><span>{session.fullName}</span><SupportLogoutButton /></div></nav>
    <section className="support-portal-content">
      <div className="support-portal-hero"><div><p className="eyebrow">ASSIGNED SUPPORT QUEUE</p><h1>Protect context. Resolve clearly.</h1><p>Only your assigned customers are visible. Claim unassigned work before opening private customer details.</p><div className={`support-workforce-state ${accepting && availability === "AVAILABLE" ? "available" : "paused"}`}><b>{availability.replaceAll("_", " ")}</b><span>{accepting ? `Accepting assignments · ${mine.length}/${capacity} capacity` : "New assignments paused by Admin"}</span>{profile?.statusNote ? <small>{profile.statusNote}</small> : null}</div></div>
        <div className="support-agent-stats"><article><b>{mine.length}</b><span>Active</span></article><article><b>{waiting}</b><span>Waiting</span></article><article className={breached ? "danger" : ""}><b>{breached}</b><span>SLA breached</span></article><article><b>{resolvedToday}</b><span>Resolved today</span></article><article><b>{qualityScore.toFixed(1)}</b><span>Quality · 30d</span></article><article className={coaching ? "danger" : ""}><b>{coaching}</b><span>Coaching actions</span></article><article><b>{satisfactionScore.toFixed(1)}</b><span>Customer rating · 30d</span></article><article><b>{customerResolvedRate.toFixed(0)}%</b><span>Customer-confirmed resolved</span></article></div>
      </div>
      <section className="support-queue-grid">
        <article className="support-queue-panel"><div className="support-panel-head"><div><p className="eyebrow">MY WORK</p><h2>Assigned tickets</h2></div><span>{mine.length}</span></div>{mine.length ? <div className="support-agent-ticket-list">{mine.map((ticket) => <Link href={`/support/tickets/${ticket.reference}`} key={ticket.id}><div><small>{ticket.reference} · {ticket.category.replaceAll("_", " ")}</small><b>{ticket.subject}</b><span>{ticket.customer.fullName} · {ticket.customer.accountType}{ticket.order ? ` · ${ticket.order.orderNumber}` : ""}</span></div><div><em className={`priority-${ticket.priority.toLowerCase()}`}>{ticket.priority}</em><strong>{ticketStatusLabel(ticket.status)}</strong><small className={`sla-${ticketSlaState(ticket).toLowerCase()}`}>{ticketSlaState(ticket).replaceAll("_", " ")}</small></div></Link>)}</div> : <div className="support-empty"><h3>Your queue is clear</h3><p>Claim an unassigned ticket when you are available for more work.</p></div>}</article>
        <article className="support-queue-panel"><div className="support-panel-head"><div><p className="eyebrow">SHARED QUEUE</p><h2>Unassigned</h2></div><span>{unassigned.length}</span></div>{unassigned.length ? <div className="unassigned-ticket-list">{unassigned.map((ticket) => <article key={ticket.id}><div><small>{ticket.reference} · {ticket.category.replaceAll("_", " ")}</small><b>{ticket.subject}</b><span>{ticket.customer.accountType}{ticket.order ? ` · ${ticket.order.orderNumber}` : ""}</span></div><div><em className={`priority-${ticket.priority.toLowerCase()}`}>{ticket.priority}</em><small className={`sla-${ticketSlaState(ticket).toLowerCase()}`}>{ticketSlaState(ticket).replaceAll("_", " ")}</small><TicketActionControls ticketId={ticket.id} status={ticket.status} priority={ticket.priority} version={ticket.version} unassigned /></div></article>)}</div> : <p className="support-empty-copy">No unassigned tickets.</p>}</article>
      </section>
    </section>
  </main>;
}
