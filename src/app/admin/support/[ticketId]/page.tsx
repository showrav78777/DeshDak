import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AdminLogoutButton } from "@/components/admin-logout-button";
import { SupportQualityReviewForm, TicketActionControls } from "@/components/support-forms";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { getServerSession } from "@/lib/server-session";
import { ACTIVE_TICKET_STATUSES, ticketSlaState, ticketStatusLabel } from "@/modules/support/policy";
import "../../../support/support.css";
import "../support-admin.css";

export default async function AdminSupportTicketPage({ params }: PageProps<"/admin/support/[ticketId]">) {
  const [session, route] = await Promise.all([getServerSession(), params]);
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") redirect("/admin/login");
  const [ticket, agents] = await Promise.all([
    prisma.ticket.findUnique({
      where: { id: route.ticketId },
      include: {
        customer: { select: { fullName: true, email: true, phone: true, accountType: true, locale: true } },
        assignedAgent: { select: { fullName: true } },
        order: { select: { id: true, orderNumber: true, status: true, currency: true, grandTotal: true } },
        rma: { select: { id: true, reference: true, status: true, reason: true } },
        conversation: { include: { messages: { include: { sender: { select: { fullName: true } } }, orderBy: { createdAt: "asc" } } } },
        events: { include: { actor: { select: { fullName: true } } }, orderBy: { occurredAt: "asc" } },
        qualityReview: true,
        satisfactionRating: true,
      },
    }),
    prisma.user.findMany({ where: { deletedAt: null, status: "ACTIVE", roles: { some: { role: { code: ROLE.CUSTOMER_SERVICE } } } }, select: { id: true, fullName: true, _count: { select: { assignedSupportTickets: { where: { status: { in: ACTIVE_TICKET_STATUSES } } } } } }, orderBy: { fullName: "asc" } }),
  ]);
  if (!ticket) notFound();
  const agentOptions = agents.map((agent) => ({ id: agent.id, label: `${agent.fullName} · ${agent._count.assignedSupportTickets} active` }));

  return <main className="support-portal support-admin-ticket">
    <nav className="support-portal-nav"><Link className="brand" href="/admin/support"><span className="brand-mark">D</span><span>DeshDak Admin</span></Link><div><Link href="/admin/support">Support oversight</Link><span>{session.fullName}</span><AdminLogoutButton /></div></nav>
    <section className="support-workspace"><Link className="support-back" href="/admin/support">← Support operations</Link><div className="support-workspace-grid">
      <section><div className="ticket-detail-head"><div><p className="eyebrow">ADMIN MONITOR · {ticket.reference}</p><h1>{ticket.subject}</h1><p>{ticket.category.replaceAll("_", " ")} · assigned to {ticket.assignedAgent?.fullName ?? "nobody"}</p></div><div><em className={`priority-${ticket.priority.toLowerCase()}`}>{ticket.priority}</em><b>{ticketStatusLabel(ticket.status)}</b><small className={`sla-${ticketSlaState(ticket).toLowerCase()}`}>{ticketSlaState(ticket).replaceAll("_", " ")} · due {ticket.slaDueAt.toLocaleString()}</small></div></div>
        <section className="conversation-card"><div className="conversation-heading"><h2>Full transcript</h2><span>{ticket.conversation?.messages.length ?? 0} messages and notes</span></div><div className="conversation-thread">{ticket.conversation?.messages.map((message) => <article className={message.internalNote ? "internal" : "customer"} key={message.id}><header><b>{message.internalNote ? `Internal · ${message.sender.fullName}` : message.sender.fullName}</b><time>{message.createdAt.toLocaleString()}</time></header><p>{message.body}</p></article>)}</div><p className="support-oversight-notice">Admin access is read-only for customer communication. Assign, reprioritize, or escalate here; the assigned Customer Service agent must publish replies, notes, and resolutions.</p></section>
        <section className="conversation-card support-admin-review"><h2>Quality review</h2>{["RESOLVED", "CLOSED"].includes(ticket.status) ? <SupportQualityReviewForm ticketId={ticket.id} review={ticket.qualityReview} /> : ticket.qualityReview ? <><b>{ticket.qualityReview.score}/5 · {ticket.qualityReview.outcome.replaceAll("_", " ")}</b><p>{ticket.qualityReview.summary}</p><p>Reopen work must be resolved before this review can be updated.</p></> : <p>Resolve or close the ticket before recording a supervisor quality review.</p>}</section>
      </section>
      <aside className="support-customer-context"><section><p className="eyebrow">CUSTOMER</p><h2>{ticket.customer.fullName}</h2><dl><div><dt>Account</dt><dd>{ticket.customer.accountType}</dd></div><div><dt>Email</dt><dd>{ticket.customer.email}</dd></div><div><dt>Phone</dt><dd>{ticket.customer.phone ?? "Not recorded"}</dd></div><div><dt>Language</dt><dd>{ticket.customer.locale}</dd></div></dl></section>
        {ticket.order ? <section><p className="eyebrow">ORDER</p><b>{ticket.order.orderNumber}</b><span>{ticket.order.status.replaceAll("_", " ")} · {ticket.order.currency} {ticket.order.grandTotal.toString()}</span></section> : null}
        {ticket.rma ? <section><p className="eyebrow">CLAIM</p><b>{ticket.rma.reference}</b><span>{ticket.rma.status.replaceAll("_", " ")} · {ticket.rma.reason.replaceAll("_", " ")}</span></section> : null}
        <section><p className="eyebrow">ADMIN OVERSIGHT</p><TicketActionControls ticketId={ticket.id} status={ticket.status} priority={ticket.priority} version={ticket.version} agents={agentOptions} oversightOnly /></section>
        <section className={ticket.satisfactionRating && (ticket.satisfactionRating.score <= 2 || !ticket.satisfactionRating.issueResolved) ? "support-satisfaction-alert" : ""}><p className="eyebrow">CUSTOMER SATISFACTION</p>{ticket.satisfactionRating ? <><b>{ticket.satisfactionRating.score}/5 · {ticket.satisfactionRating.issueResolved ? "Issue resolved" : "Further attention requested"}</b>{ticket.satisfactionRating.comment ? <span>{ticket.satisfactionRating.comment}</span> : null}<small>Submitted {ticket.satisfactionRating.submittedAt.toLocaleString()} · immutable customer response</small></> : <small>No customer feedback has been submitted.</small>}</section>
        <section><p className="eyebrow">HISTORY</p><ol className="ticket-event-list">{ticket.events.map((event) => <li key={event.id}><b>{ticketStatusLabel(event.toStatus)}</b><span>{event.note}</span><small>{event.actor?.fullName ?? "System"} · {event.occurredAt.toLocaleString()}</small></li>)}</ol></section>
      </aside>
    </div></section>
  </main>;
}
