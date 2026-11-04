import type { Prisma } from "@prisma/client";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CustomerAdminHeader } from "@/components/customer-admin-header";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { getServerSession } from "@/lib/server-session";

export const dynamic = "force-dynamic";

export default async function AdminCustomersPage({ searchParams }: PageProps<"/admin/customers">) {
  const [session, params] = await Promise.all([getServerSession(), searchParams]);
  if (!session?.roles.includes(ROLE.ADMIN)) redirect("/");
  const query = typeof params.q === "string" ? params.q.trim().slice(0, 120) : "";
  const market = params.market === "bangladesh" || params.market === "international" ? params.market : "all";
  const page = Math.max(1, Number(typeof params.page === "string" ? params.page : 1) || 1);
  const pageSize = 20;
  const where: Prisma.UserWhereInput = {
    deletedAt: null,
    roles: { some: { role: { code: { in: [ROLE.CUSTOMER_PERSONAL, "customer_business"] } } } },
    ...(market === "bangladesh" ? { residenceCountryCode: "BD" } : market === "international" ? { residenceCountryCode: { not: "BD" } } : {}),
    ...(query ? { OR: [{ personCode: { contains: query, mode: "insensitive" } }, { fullName: { contains: query, mode: "insensitive" } }, { email: { contains: query, mode: "insensitive" } }, { phone: { contains: query, mode: "insensitive" } }] } : {}),
  };
  const [customers, total] = await prisma.$transaction([
    prisma.user.findMany({ where, select: { id: true, personCode: true, fullName: true, email: true, phone: true, residenceCountryCode: true, status: true, accountType: true, kycStatus: true, analyticsConsent: true, createdAt: true, authSessions: { select: { lastSeenAt: true }, orderBy: { lastSeenAt: "desc" }, take: 1 }, _count: { select: { orders: true, sourcingRequests: true } }, orders: { where: { status: { not: "CANCELLED" } }, select: { grandTotal: true } } }, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.user.count({ where }),
  ]);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return <main className="dashboard-shell"><CustomerAdminHeader name={session.fullName} /><section className="admin-content customer-records"><p className="eyebrow">CUSTOMER RECORDS</p><h1>Customers and account activity.</h1><p className="admin-intro">Search registered customers and review their orders, wallet, sourcing, sessions, notifications, and privacy-aware activity history.</p><nav className="customer-pagination" aria-label="Customer market"><Link href="/admin/customers">All customers</Link><Link href="/admin/customers?market=bangladesh">Bangladesh</Link><Link href="/admin/customers?market=international">International</Link></nav><form className="customer-search-form"><label htmlFor="customer-search">Search customer</label><div><input id="customer-search" name="q" defaultValue={query} placeholder="Name, email, or phone" /><input name="market" type="hidden" value={market} /><button className="button primary" type="submit">Search</button>{query ? <Link href={`/admin/customers${market === "all" ? "" : `?market=${market}`}`}>Clear</Link> : null}</div></form><div className="customer-record-summary"><b>{total}</b><span>{market === "bangladesh" ? "Bangladesh" : market === "international" ? "international" : "registered"} customer{total === 1 ? "" : "s"}</span><small>Passwords, tokens, and private provider data are never displayed.</small></div>{customers.length ? <div className="customer-table-wrap"><table className="customer-table"><thead><tr><th>Customer</th><th>Market</th><th>Account</th><th>Orders</th><th>Total order value</th><th>Last activity</th><th /></tr></thead><tbody>{customers.map((customer) => <tr key={customer.id}><td><b>{customer.fullName}</b><small>{customer.email}</small><small>{customer.phone ?? "No phone recorded"}</small></td><td><b>{customer.residenceCountryCode === "BD" ? "Bangladesh" : "International"}</b><small>{customer.residenceCountryCode}</small></td><td><span>{customer.accountType}</span><small>{customer.status} · KYC {customer.kycStatus}</small><small>Optional analytics {customer.analyticsConsent ? "allowed" : "off"}</small></td><td><b>{customer._count.orders}</b><small>{customer._count.sourcingRequests} sourcing request{customer._count.sourcingRequests === 1 ? "" : "s"}</small></td><td>৳{customer.orders.reduce((sum, order) => sum + Number(order.grandTotal), 0).toFixed(2)}</td><td>{customer.authSessions[0]?.lastSeenAt.toLocaleString() ?? "Never signed in"}<small>Joined {customer.createdAt.toLocaleDateString()}</small></td><td><Link href={`/admin/customers/${customer.id}`}>Open 360 →</Link></td></tr>)}</tbody></table></div> : <div className="dashboard-card"><h2>No customers found</h2><p>Try another name, email address, phone number, or market.</p></div>}{pages > 1 ? <nav className="customer-pagination"><span>{page > 1 ? <Link href={`/admin/customers?${new URLSearchParams({ ...(query ? { q: query } : {}), ...(market !== "all" ? { market } : {}), page: String(page - 1) })}`}>← Previous</Link> : null}</span><b>Page {page} of {pages}</b><span>{page < pages ? <Link href={`/admin/customers?${new URLSearchParams({ ...(query ? { q: query } : {}), ...(market !== "all" ? { market } : {}), page: String(page + 1) })}`}>Next →</Link> : null}</span></nav> : null}</section></main>;
}
