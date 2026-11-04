import Link from "next/link";
import { redirect } from "next/navigation";
import { CustomerNav } from "@/components/store-header";
import { PrivacyAnalyticsControl } from "@/components/privacy-analytics-control";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { getServerSession } from "@/lib/server-session";

export const dynamic = "force-dynamic";

export default async function CustomerDashboardPage() {
  const session = await getServerSession();
  if (!session?.roles.includes(ROLE.CUSTOMER_PERSONAL)) redirect("/login?next=/dashboard");
  const [orderCount, requestCount, cart, wallet, recentOrders, authSession, privacy] = await Promise.all([
    prisma.order.count({ where: { customerId: session.userId } }),
    prisma.sourcingRequest.count({ where: { customerId: session.userId } }),
    prisma.cart.findUnique({ where: { userId_currency: { userId: session.userId, currency: "BDT" } }, select: { _count: { select: { items: true } } } }),
    prisma.wallet.findUnique({ where: { userId_currency: { userId: session.userId, currency: "BDT" } }, select: { availableBalance: true } }),
    prisma.order.findMany({ where: { customerId: session.userId }, select: { id: true, orderNumber: true, status: true, grandTotal: true, items: { select: { productTitle: true }, take: 1 } }, orderBy: { createdAt: "desc" }, take: 3 }),
    prisma.authSession.findUnique({ where: { id: session.sessionId }, select: { lastSeenAt: true, expiresAt: true } }),
    prisma.user.findUnique({ where: { id: session.userId }, select: { analyticsConsent: true, analyticsConsentAt: true } }),
  ]);
  const firstName = session.fullName.trim().split(/\s+/)[0];
  return <main className="dashboard-shell customer-dashboard"><CustomerNav session={session} /><section className="customer-dashboard-content"><p className="eyebrow">CUSTOMER DASHBOARD</p><h1>Welcome back, {firstName}.</h1><p className="dashboard-lead">Your products, orders, wallet, sourcing requests, and delivery updates stay connected to this secure account.</p><div className="customer-stat-grid"><Link href="/orders"><span>Orders</span><b>{orderCount}</b><small>View product timelines</small></Link><Link href="/buy-ship"><span>Sourcing requests</span><b>{requestCount}</b><small>Request from China</small></Link><Link href="/cart"><span>Cart products</span><b>{cart?._count.items ?? 0}</b><small>Continue checkout</small></Link><Link href="/wallet"><span>Wallet balance</span><b>৳{wallet?.availableBalance.toString() ?? "0.00"}</b><small>Refunds and spending</small></Link></div><div className="dashboard-home-grid"><section><div className="updates-head"><div><h2>Recent orders</h2><p>Your latest account-specific order activity.</p></div><Link href="/orders">View all →</Link></div>{recentOrders.length ? recentOrders.map((order) => <Link className="dashboard-order-row" href={`/orders/${order.id}`} key={order.id}><div><b>{order.items[0]?.productTitle ?? order.orderNumber}</b><small>{order.orderNumber} · {order.status.replaceAll("_", " ")}</small></div><span>৳{order.grandTotal.toString()}</span></Link>) : <div className="dashboard-empty"><b>No orders yet</b><p>Browse approved products or submit a Buy & Ship request.</p><Link className="button primary" href="/products">Browse products</Link></div>}</section><aside><p className="eyebrow">SECURE SESSION</p><h2>Your account is active</h2><p>Signed in as <b>{session.fullName}</b>. This browser session is revocable and expires automatically.</p><dl><div><dt>Last activity</dt><dd>{authSession?.lastSeenAt.toLocaleString() ?? "Now"}</dd></div><div><dt>Session expires</dt><dd>{authSession?.expiresAt.toLocaleString() ?? "Automatically"}</dd></div></dl></aside></div><PrivacyAnalyticsControl enabled={privacy?.analyticsConsent ?? false} recordedAt={privacy?.analyticsConsentAt?.toISOString() ?? null} /></section></main>;
}
