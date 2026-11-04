import Link from "next/link";
import { redirect } from "next/navigation";

import { CustomerNav } from "@/components/store-header";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { getServerSession } from "@/lib/server-session";
import { rmaStatusLabel } from "@/modules/rma/policy";

export default async function CustomerRmasPage() {
  const session = await getServerSession();
  if (!session?.roles.includes(ROLE.CUSTOMER_PERSONAL)) redirect("/login?next=/rmas");
  const rmas = await prisma.rma.findMany({ where: { customerId: session.userId }, include: { order: { select: { orderNumber: true } }, shipment: { select: { trackingNumber: true } } }, orderBy: { createdAt: "desc" }, take: 100 });
  return <main className="dashboard-shell"><CustomerNav session={session} /><section className="order-detail-page"><div className="order-detail-head"><div><p className="eyebrow">RETURNS & CLAIMS</p><h1>Your problem reports</h1><p>Track review, return, inspection, refund, or replacement decisions.</p></div><Link className="button secondary" href="/orders">Find an order</Link></div>{rmas.length ? <div className="rma-list">{rmas.map((rma) => <Link href={`/rmas/${rma.id}`} key={rma.id}><div><small>{rma.order.orderNumber} · {rma.shipment.trackingNumber}</small><b>{rma.reference}</b><span>{rma.reason.replaceAll("_", " ")} · Opened {rma.createdAt.toLocaleDateString()}</span></div><div><em className={`status-${rma.status.toLowerCase()}`}>{rmaStatusLabel(rma.status)}</em><small>{rma.decision === "PENDING" ? `Review due ${rma.slaDueAt.toLocaleDateString()}` : rma.decision.replaceAll("_", " ")}</small></div></Link>)}</div> : <section className="detail-card"><h2>No claims yet</h2><p className="empty-copy">Open a delivered order and choose “Report a problem” within its claim deadline.</p><Link className="button primary" href="/orders">View my orders</Link></section>}</section></main>;
}
