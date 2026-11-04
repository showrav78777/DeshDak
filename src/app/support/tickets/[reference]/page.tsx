import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { SupportLogoutButton, TicketActionControls, TicketMessageForm } from "@/components/support-forms";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { getServerSession } from "@/lib/server-session";
import { ticketSlaState, ticketStatusLabel } from "@/modules/support/policy";

export default async function SupportTicketWorkspace({ params }: PageProps<"/support/tickets/[reference]">) {
  const [session, route] = await Promise.all([getServerSession(), params]);
  if (!session?.roles.includes(ROLE.CUSTOMER_SERVICE) || session.portal !== "support") redirect("/support/login");
  const ticket = await prisma.ticket.findFirst({
    where: { reference: route.reference, assignedAgentId: session.userId },
    include: {
      customer: { select: { fullName: true, email: true, phone: true, accountType: true, locale: true } },
      order: { select: { id: true, orderNumber: true, status: true, currency: true, grandTotal: true } },
      rma: { select: { id: true, reference: true, status: true, reason: true } },
      conversation: { include: { messages: { include: { sender: { select: { fullName: true } } }, orderBy: { createdAt: "asc" } } } },
      events: { include: { actor: { select: { fullName: true } } }, orderBy: { occurredAt: "asc" } },
      qualityReview: { select: { score: true, outcome: true, summary: true, coachingAction: true, reviewedAt: true } },
      satisfactionRating: { select: { score: true, issueResolved: true, comment: true, submittedAt: true } },
    },
  });
  if (!ticket) notFound();

  return <main className="support-portal">
    <nav className="support-portal-nav"><Link className="brand" href="/support/tickets"><span className="brand-mark">D</span><span>DeshDak CS</span></Link><div><Link href="/support/tickets">Queue</Link><span>{session.fullName}</span><SupportLogoutButton /></div></nav>
    <section className="support-workspace"><Link className="support-back" href="/support/tickets">← Assigned queue</Link><div className="support-workspace-grid">
      <section><div className="ticket-detail-head"><div><p className="eyebrow">{ticket.reference}</p><h1>{ticket.subject}</h1><p>{ticket.category.replaceAll("_", " ")}</p></div><div><em className={`priority-${ticket.priority.toLowerCase()}`}>{ticket.priority}</em><b>{ticketStatusLabel(ticket.status)}</b><small className={`sla-${ticketSlaState(ticket).toLowerCase()}`}>{ticketSlaState(ticket).replaceAll("_", " ")} · due {ticket.slaDueAt.toLocaleString()}</small></div></div>
        <section className="conversation-card"><div className="conversation-heading"><h2>Customer conversation</h2><span>{ticket.conversation?.messages.filter((message) => !message.internalNote).length ?? 0} public replies</span></div><div className="conversation-thread">{ticket.conversation?.messages.map((message) => <article className={message.internalNote ? "internal" : message.senderId === session.userId ? "mine" : "customer"} key={message.id}><header><b>{message.internalNote ? `Internal · ${message.sender.fullName}` : message.senderId === session.userId ? "You" : message.sender.fullName}</b><time>{message.createdAt.toLocaleString()}</time></header><p>{message.body}</p></article>)}</div>{ticket.status !== "CLOSED" ? <TicketMessageForm ticketId={ticket.id} allowInternalNote /> : <p className="support-closed">This request is closed.</p>}</section>
      </section>
      <aside className="support-customer-context">
        <section><p className="eyebrow">ASSIGNED CUSTOMER</p><h2>{ticket.customer.fullName}</h2><dl><div><dt>Account</dt><dd>{ticket.customer.accountType}</dd></div><div><dt>Email</dt><dd>{ticket.customer.email}</dd></div><div><dt>Phone</dt><dd>{ticket.customer.phone ?? "Not recorded"}</dd></div><div><dt>Language</dt><dd>{ticket.customer.locale}</dd></div></dl><small>Use this data only to resolve this assigned request.</small></section>
        {ticket.order ? <section><p className="eyebrow">ORDER CONTEXT</p><b>{ticket.order.orderNumber}</b><span>{ticket.order.status.replaceAll("_", " ")}</span><small>{ticket.order.currency} {ticket.order.grandTotal.toString()}</small></section> : null}
        {ticket.rma ? <section><p className="eyebrow">CLAIM CONTEXT</p><b>{ticket.rma.reference}</b><span>{ticket.rma.status.replaceAll("_", " ")} · {ticket.rma.reason.replaceAll("_", " ")}</span></section> : null}
        <section><p className="eyebrow">CONTROL</p><TicketActionControls ticketId={ticket.id} status={ticket.status} priority={ticket.priority} version={ticket.version} /></section>
        {ticket.qualityReview ? <section className="support-quality-feedback"><p className="eyebrow">QUALITY FEEDBACK</p><b>{ticket.qualityReview.score}/5 · {ticket.qualityReview.outcome.replaceAll("_", " ")}</b><span>{ticket.qualityReview.summary}</span>{ticket.qualityReview.coachingAction ? <small>Action: {ticket.qualityReview.coachingAction}</small> : null}<small>Reviewed {ticket.qualityReview.reviewedAt.toLocaleDateString()}</small></section> : null}
        {ticket.satisfactionRating ? <section className={ticket.satisfactionRating.score <= 2 || !ticket.satisfactionRating.issueResolved ? "support-satisfaction-alert" : ""}><p className="eyebrow">CUSTOMER SATISFACTION</p><b>{ticket.satisfactionRating.score}/5 · {ticket.satisfactionRating.issueResolved ? "Issue resolved" : "Further attention requested"}</b>{ticket.satisfactionRating.comment ? <span>{ticket.satisfactionRating.comment}</span> : null}<small>Submitted {ticket.satisfactionRating.submittedAt.toLocaleString()}</small></section> : null}
        <section><p className="eyebrow">AUDITABLE HISTORY</p><ol className="ticket-event-list">{ticket.events.map((event) => <li key={event.id}><b>{ticketStatusLabel(event.toStatus)}</b><span>{event.note}</span><small>{event.actor?.fullName ?? "System"} · {event.occurredAt.toLocaleString()}</small></li>)}</ol></section>
      </aside>
    </div></section>
  </main>;
}
