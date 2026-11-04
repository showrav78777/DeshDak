import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { CustomerLogoutButton } from "@/components/customer-logout-button";
import { SupportSatisfactionForm, TicketMessageForm } from "@/components/support-forms";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { getServerSession } from "@/lib/server-session";
import { ticketSlaState, ticketStatusLabel } from "@/modules/support/policy";

export default async function CustomerTicketPage({ params }: PageProps<"/support/[ticketId]">) {
  const [session, route] = await Promise.all([getServerSession(), params]);
  if (!session?.roles.includes(ROLE.CUSTOMER_PERSONAL) || session.portal !== "customer") {
    redirect(`/login?next=/support/${encodeURIComponent(route.ticketId)}`);
  }
  const ticket = await prisma.ticket.findFirst({
    where: { id: route.ticketId, customerId: session.userId },
    include: {
      assignedAgent: { select: { fullName: true } },
      order: { select: { id: true, orderNumber: true, status: true } },
      rma: { select: { id: true, reference: true, status: true } },
      conversation: { include: { messages: { where: { internalNote: false }, include: { sender: { select: { fullName: true } } }, orderBy: { createdAt: "asc" } } } },
      events: { orderBy: { occurredAt: "asc" } },
      satisfactionRating: true,
    },
  });
  if (!ticket) notFound();
  const canRate = ["RESOLVED", "CLOSED"].includes(ticket.status) && Boolean(ticket.resolvedAt && ticket.assignedAgentId);

  return <main className="support-shell">
    <nav className="site-nav support-nav"><Link className="brand" href="/support"><span className="brand-mark">D</span><span>DeshDak Support</span></Link><div><Link href="/support">All requests</Link><span>{session.fullName}</span><CustomerLogoutButton /></div></nav>
    <section className="support-content">
      <Link className="support-back" href="/support">← Support center</Link>
      <div className="ticket-detail-head"><div><p className="eyebrow">{ticket.reference}</p><h1>{ticket.subject}</h1><p>{ticket.category.replaceAll("_", " ")} · {ticket.assignedAgent?.fullName ?? "Waiting for assignment"}</p></div><div><em className={`priority-${ticket.priority.toLowerCase()}`}>{ticket.priority}</em><b>{ticketStatusLabel(ticket.status)}</b><small className={`sla-${ticketSlaState(ticket).toLowerCase()}`}>{ticketSlaState(ticket).replaceAll("_", " ")} · due {ticket.slaDueAt.toLocaleString()}</small></div></div>
      {ticket.order || ticket.rma ? <section className="ticket-context">{ticket.order ? <Link href={`/orders/${ticket.order.id}`}><small>ORDER</small><b>{ticket.order.orderNumber}</b><span>{ticket.order.status.replaceAll("_", " ")}</span></Link> : null}{ticket.rma ? <Link href={`/rmas/${ticket.rma.id}`}><small>CLAIM</small><b>{ticket.rma.reference}</b><span>{ticket.rma.status.replaceAll("_", " ")}</span></Link> : null}</section> : null}
      <section className="conversation-card"><div className="conversation-heading"><h2>Conversation</h2><span>{ticket.conversation?.messages.length ?? 0} message(s)</span></div><div className="conversation-thread">{ticket.conversation?.messages.map((message) => <article className={message.senderId === session.userId ? "mine" : "staff"} key={message.id}><header><b>{message.senderId === session.userId ? "You" : message.sender.fullName}</b><time>{message.createdAt.toLocaleString()}</time></header><p>{message.body}</p></article>)}</div>{ticket.status !== "CLOSED" ? <TicketMessageForm ticketId={ticket.id} /> : <p className="support-closed">This request is closed. Open a new request if you need more help.</p>}</section>
      {ticket.satisfactionRating ? <section className="support-satisfaction-summary"><p className="eyebrow">FEEDBACK SUBMITTED</p><h2>{ticket.satisfactionRating.score}/5 stars</h2><b>{ticket.satisfactionRating.issueResolved ? "Issue resolved" : "Further attention requested"}</b>{ticket.satisfactionRating.comment ? <p>{ticket.satisfactionRating.comment}</p> : null}<small>Submitted {ticket.satisfactionRating.submittedAt.toLocaleString()} · Responses cannot be edited.</small></section> : canRate ? <SupportSatisfactionForm ticketId={ticket.id} /> : null}
    </section>
  </main>;
}
