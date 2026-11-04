import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AccountActivityForm, OpportunityCreateForm, OpportunityStageForm } from "@/components/sales-forms";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { getServerSession } from "@/lib/server-session";

export const dynamic = "force-dynamic";

export default async function SalesAccountPage({ params }: PageProps<"/sales/accounts/[accountId]">) {
  const session = await getServerSession();
  if (!session?.roles.includes(ROLE.KAM) || session.portal !== "sales") redirect("/sales/login");
  const { accountId } = await params;
  const account = await prisma.businessAccount.findFirst({
    where: { id: accountId, status: "ACTIVE", assignments: { some: { userId: session.userId, isActive: true } } },
    select: {
      id: true, accountCode: true, organizationName: true,
      owner: { select: { personCode: true, fullName: true, email: true, phone: true, residenceCountryCode: true, orders: { select: { id: true, orderNumber: true, status: true, grandTotal: true, currency: true }, orderBy: { createdAt: "desc" }, take: 20 }, sourcingRequests: { select: { id: true, reference: true, productTitle: true, status: true, quantity: true }, orderBy: { createdAt: "desc" }, take: 20 }, supportTickets: { select: { id: true, reference: true, subject: true, status: true, priority: true }, orderBy: { createdAt: "desc" }, take: 20 } } },
      activities: { select: { id: true, activityCode: true, type: true, subject: true, note: true, occurredAt: true, followUpAt: true, author: { select: { fullName: true, personCode: true } }, sourcingRequest: { select: { reference: true } } }, orderBy: { occurredAt: "desc" }, take: 100 },
      opportunities: { select: { id: true, opportunityCode: true, title: true, stage: true, estimatedValue: true, currency: true, expectedCloseAt: true, note: true, version: true, owner: { select: { fullName: true, personCode: true } }, sourcingRequest: { select: { reference: true } }, stageChanges: { select: { id: true, fromStage: true, toStage: true, note: true, createdAt: true, actor: { select: { fullName: true, personCode: true } } }, orderBy: { createdAt: "desc" }, take: 10 } }, orderBy: { updatedAt: "desc" }, take: 200 },
    },
  });
  if (!account) notFound();
  const requests = account.owner.sourcingRequests.map(({ id, reference, productTitle }) => ({ id, reference, productTitle }));

  return <main className="dashboard-shell"><nav className="site-nav"><Link className="brand" href="/sales"><span className="brand-mark">D</span><span>DeshDak Sales</span></Link><Link href="/sales">← Portfolio</Link></nav><section className="admin-content"><p className="eyebrow">{account.accountCode}</p><h1>{account.organizationName}</h1><p className="admin-intro">{account.owner.fullName} · {account.owner.personCode} · {account.owner.email} · {account.owner.phone ?? "No phone"} · {account.owner.residenceCountryCode}</p>
    <div className="admin-reel-summary"><article><b>{account.opportunities.length}</b><span>Opportunities</span></article><article><b>{account.owner.orders.length}</b><span>Recent orders</span></article><article><b>{account.owner.sourcingRequests.length}</b><span>Sourcing requests</span></article><article><b>{account.owner.supportTickets.length}</b><span>Support tickets</span></article></div>
    <section className="country-list-card"><h2>Create opportunity</h2><p>Track a Business opportunity without exposing supplier cost or Finance-only margin information.</p><OpportunityCreateForm accountId={account.id} sourcingRequests={requests} /></section>
    <section className="country-list-card"><h2>Opportunity pipeline</h2>{account.opportunities.length ? <div className="compliance-rule-list">{account.opportunities.map((opportunity) => <article key={opportunity.id}><header><div><b>{opportunity.title}</b><span>{opportunity.opportunityCode} · Owner {opportunity.owner.fullName} ({opportunity.owner.personCode})</span></div><em>{opportunity.stage.replaceAll("_", " ")}</em></header><p>{opportunity.sourcingRequest ? `RFQ ${opportunity.sourcingRequest.reference}` : "No RFQ linked"}{opportunity.estimatedValue && opportunity.currency ? ` · ${opportunity.currency} ${opportunity.estimatedValue.toString()}` : ""}{opportunity.expectedCloseAt ? ` · Expected ${opportunity.expectedCloseAt.toLocaleDateString()}` : ""}</p>{opportunity.note ? <small>{opportunity.note}</small> : null}<OpportunityStageForm opportunityId={opportunity.id} currentStage={opportunity.stage} version={opportunity.version} />{opportunity.stageChanges.length ? <details><summary>Stage history ({opportunity.stageChanges.length})</summary>{opportunity.stageChanges.map((change) => <p key={change.id}><small>{change.fromStage ? `${change.fromStage} → ` : "Created at "}{change.toStage} · {change.createdAt.toLocaleString()} · {change.actor.fullName}{change.note ? ` · ${change.note}` : ""}</small></p>)}</details> : null}</article>)}</div> : <p>No opportunities have been created.</p>}</section>
    <section className="country-list-card"><h2>Record relationship activity</h2><AccountActivityForm accountId={account.id} sourcingRequests={requests} /></section>
    <section className="country-list-card"><h2>Activity history</h2>{account.activities.length ? <div className="compliance-rule-list">{account.activities.map((activity) => <article key={activity.id}><header><div><b>{activity.subject}</b><span>{activity.activityCode} · {activity.type.replaceAll("_", " ")}</span></div><em>{activity.occurredAt.toLocaleString()}</em></header><p>{activity.note}</p><small>{activity.author.fullName} · {activity.author.personCode}{activity.sourcingRequest ? ` · ${activity.sourcingRequest.reference}` : ""}{activity.followUpAt ? ` · Follow up ${activity.followUpAt.toLocaleString()}` : ""}</small></article>)}</div> : <p>No activity has been recorded.</p>}</section>
    <section className="country-list-card"><h2>Recent orders</h2>{account.owner.orders.map((order) => <p key={order.id}><b>{order.orderNumber}</b> · {order.status.replaceAll("_", " ")} · {order.currency} {order.grandTotal.toString()}</p>)}</section>
    <section className="country-list-card"><h2>Sourcing requests</h2>{account.owner.sourcingRequests.map((request) => <p key={request.id}><b>{request.reference}</b> · {request.productTitle ?? "Product request"} · {request.quantity} units · {request.status.replaceAll("_", " ")}</p>)}</section>
    <section className="country-list-card"><h2>Support history</h2>{account.owner.supportTickets.map((ticket) => <p key={ticket.id}><b>{ticket.reference}</b> · {ticket.subject} · {ticket.priority} · {ticket.status.replaceAll("_", " ")}</p>)}</section>
  </section></main>;
}
