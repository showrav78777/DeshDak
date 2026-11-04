import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminSellerCatalogConnections } from "@/components/admin-seller-catalog-connections";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import { sellerCatalogConnectionView } from "@/modules/catalog/seller-catalog-connection";

export const dynamic = "force-dynamic";

export default async function AdminSellerIntegrationsPage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") redirect("/");
  const connections = await prisma.sellerCatalogConnection.findMany({ include: { sellerProfile: { select: { businessName: true, user: { select: { fullName: true, email: true } } } } }, orderBy: [{ status: "asc" }, { createdAt: "asc" }] });
  const views = connections.map((connection) => ({ ...sellerCatalogConnectionView(connection, true), seller: connection.sellerProfile }));
  return <main className="dashboard-shell"><nav className="site-nav"><Link className="brand" href="/admin"><span className="brand-mark">D</span><span>DeshDak Admin</span></Link><span className="dashboard-user">{session.fullName}</span></nav><section className="admin-content admin-seller-integrations-page"><p className="eyebrow">BANGLADESH SELLER CATALOG CONNECTIONS</p><h1>Review seller-owned API access.</h1><p className="admin-intro">Verify seller authority, official API documentation, read-only scope, data rights, media rights, and secure credential handling. Store only a secret-manager reference.</p><aside className="integration-lock-banner"><b>All seller synchronization remains fail-closed.</b><span>Configuration approval cannot activate a connection. A reviewed adapter, controlled HTTP client, secret resolver, normalization, moderation, webhooks, reconciliation, health monitoring, and operational release are still required.</span></aside><AdminSellerCatalogConnections connections={views} /></section></main>;
}
