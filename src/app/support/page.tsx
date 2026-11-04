import Link from "next/link";
import { redirect } from "next/navigation";

import { CustomerLogoutButton } from "@/components/customer-logout-button";
import { TicketCreateForm } from "@/components/support-forms";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { getServerSession } from "@/lib/server-session";
import { getSupportOperatingPolicy, ticketSlaState, ticketStatusLabel } from "@/modules/support/policy";

export const dynamic = "force-dynamic";

function supportHours(openingMinute: number, closingMinute: number) {
  const label = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  return `${label(openingMinute)}–${label(closingMinute)}`;
}

export default async function CustomerSupportPage() {
  const session = await getServerSession();
  if (session?.roles.includes(ROLE.CUSTOMER_SERVICE) && session.portal === "support") redirect("/support/tickets");
  if (!session?.roles.includes(ROLE.CUSTOMER_PERSONAL) || session.portal !== "customer") redirect("/login?next=/support");
  const [tickets, orders, rmas, policy] = await Promise.all([
    prisma.ticket.findMany({ where: { customerId: session.userId }, include: { assignedAgent: { select: { fullName: true } }, conversation: { select: { lastMessageAt: true } }, order: { select: { orderNumber: true } }, rma: { select: { reference: true } } }, orderBy: { updatedAt: "desc" }, take: 100 }),
    prisma.order.findMany({ where: { customerId: session.userId }, select: { id: true, orderNumber: true, status: true }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.rma.findMany({ where: { customerId: session.userId }, select: { id: true, reference: true, status: true }, orderBy: { createdAt: "desc" }, take: 50 }),
    getSupportOperatingPolicy(prisma),
  ]);
  const dayLabel = policy.firstResponseBusinessDays === 1 ? "business day" : "business days";

  return <main className="support-shell">
    <nav className="site-nav support-nav"><Link className="brand" href="/"><span className="brand-mark">D</span><span>DeshDak Support</span></Link><div><Link href="/help">Help Centre</Link><Link href="/dashboard">Dashboard</Link><span>{session.fullName}</span><CustomerLogoutButton /></div></nav>
    <section className="support-content"><div className="support-hero"><div><p className="eyebrow">HELP CENTER</p><h1>One place for every request.</h1><p>Open a request, follow every verified reply, and keep order or claim context attached to the conversation.</p></div><aside><b>First-response target</b><span>Within {policy.firstResponseBusinessDays} {dayLabel}</span><small>{supportHours(policy.openingMinute, policy.closingMinute)} · {policy.timeZone}. Holidays and configured business days apply.</small></aside></div>
      <section className="support-layout"><article className="support-panel"><h2>Open a support request</h2><TicketCreateForm orders={orders.map((order) => ({ id: order.id, label: `${order.orderNumber} · ${order.status.replaceAll("_", " ")}` }))} rmas={rmas.map((rma) => ({ id: rma.id, label: `${rma.reference} · ${rma.status.replaceAll("_", " ")}` }))} /></article><article className="support-panel"><div className="support-panel-head"><div><h2>Your requests</h2><p>{tickets.length} recorded</p></div></div>{tickets.length ? <div className="ticket-list">{tickets.map((ticket) => <Link href={`/support/${ticket.id}`} key={ticket.id}><div><small>{ticket.category.replaceAll("_", " ")}{ticket.order ? ` · ${ticket.order.orderNumber}` : ticket.rma ? ` · ${ticket.rma.reference}` : ""}</small><b>{ticket.subject}</b><span>{ticket.reference} · {ticket.assignedAgent?.fullName ?? "Waiting for assignment"}</span></div><div><em className={`priority-${ticket.priority.toLowerCase()}`}>{ticket.priority}</em><strong>{ticketStatusLabel(ticket.status)}</strong><small className={`sla-${ticketSlaState(ticket).toLowerCase()}`}>{ticketSlaState(ticket).replaceAll("_", " ")}</small></div></Link>)}</div> : <div className="support-empty"><span>◎</span><h3>No support requests yet</h3><p>Your new request will appear here with its response deadline and full history.</p></div>}</article></section>
    </section>
  </main>;
}
