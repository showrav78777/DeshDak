import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ShippingQuoteForm } from "@/components/shipping-quote-form";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

const statusLabel: Record<string, string> = { MEASURED: "Ready to quote", SHIPPING_QUOTE_PENDING_CUSTOMER_APPROVAL: "Customer decision needed", SHIPPING_QUOTE_READY: "Ready for shipping payment" };

export default async function AdminShippingQuotesPage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;
  if (!session?.roles.includes(ROLE.ADMIN)) redirect("/");
  const [orders, lanes] = await Promise.all([
    prisma.order.findMany({ where: { status: { in: ["MEASURED", "SHIPPING_QUOTE_PENDING_CUSTOMER_APPROVAL", "SHIPPING_QUOTE_READY"] } }, include: { customer: { select: { fullName: true, email: true } }, packages: { select: { packageCode: true, chargeableWeightGrams: true, status: true } }, shipForMeRequest: { select: { reference: true, itemDescription: true } }, sourcingRequest: { include: { quotes: { where: { status: "ACCEPTED" }, orderBy: { version: "desc" }, take: 1 } } }, shippingQuotes: { orderBy: { version: "desc" }, take: 1 } }, orderBy: { updatedAt: "desc" } }),
    prisma.shippingLane.findMany({ where: { isActive: true, financeApproved: true, complianceApproved: true, operationsApproved: true }, include: { originCountry: { select: { isoCode: true, name: true } }, destinationCountry: { select: { isoCode: true, name: true } } }, orderBy: { name: "asc" } }),
  ]);
  return <main className="dashboard-shell"><nav className="site-nav"><Link className="brand" href="/admin"><span className="brand-mark">D</span><span>DeshDak Admin</span></Link><span className="dashboard-user">{session.fullName}</span></nav><section className="admin-content"><p className="eyebrow">FINAL SHIPPING QUOTES</p><h1>Price shipping after measurement.</h1><p className="admin-intro">Product payment stays separate. Confirmed chargeable weight drives the final quote, and missing or significantly different declared weight requires customer approval.</p>{orders.length ? <div className="operations-order-list">{orders.map((order) => {
    const weight = order.packages.reduce((sum, pkg) => sum + (pkg.chargeableWeightGrams ?? 0), 0);
    const declared = order.sourcingRequest?.quotes[0]?.declaredWeightGrams ?? null;
    const latest = order.shippingQuotes[0];
    const sourceCountry = order.originCountryCode ?? order.sourcingRequest?.sourceCountryCode ?? "CN";
    const laneOptions = lanes.filter((lane) => order.shippingLaneId ? lane.id === order.shippingLaneId : lane.originCountry.isoCode === sourceCountry).map((lane) => ({ id: lane.id, label: `${lane.originCountry.name} → ${lane.destinationCountry.name} · ${lane.name} · approval above ${lane.weightDiscrepancyThresholdPercent.toString()}%` }));
    const title = order.shipForMeRequest?.itemDescription ?? order.sourcingRequest?.productTitle ?? `${order.type.replaceAll("_", " ")} order`;
    return <article className="operations-order-card" key={order.id}><div className="operations-order-summary"><div className="order-card-head"><div><p>{order.orderNumber}{order.shipForMeRequest ? ` · ${order.shipForMeRequest.reference}` : ""}</p><h2>{title}</h2></div><b className={`status-${order.status.toLowerCase()}`}>{statusLabel[order.status] ?? order.status}</b></div><dl><div><dt>Customer</dt><dd>{order.customer.fullName}<small>{order.customer.email}</small></dd></div><div><dt>Measured weight</dt><dd>{weight.toLocaleString()} g</dd></div><div><dt>Declared weight</dt><dd>{declared ? `${declared.toLocaleString()} g` : "Not recorded — approval required"}</dd></div><div><dt>Packages</dt><dd>{order.packages.length}</dd></div></dl>{latest ? <div className="recent-admin-updates"><b>Latest final quote · version {latest.version}</b><p><span>৳{latest.totalBdt.toString()}</span><small>{latest.status} · expires {latest.expiresAt.toLocaleString()}</small></p></div> : null}</div>{order.status === "MEASURED" ? <ShippingQuoteForm orderId={order.id} lanes={laneOptions} /> : <div className="terminal-order-note"><b>{order.status === "SHIPPING_QUOTE_READY" ? "Quote can move to shipping payment" : "Waiting for customer"}</b><p>{order.status === "SHIPPING_QUOTE_READY" ? "The customer can review the final amount on the order page." : "The order cannot enter shipping payment until the customer accepts or places shipping on hold."}</p></div>}</article>;
  })}</div> : <div className="dashboard-card"><h2>No measured orders waiting</h2><p>Orders appear here after warehouse inspection and measurement are complete.</p></div>}</section></main>;
}
