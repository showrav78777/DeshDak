import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SellerCatalogConnectionWorkspace } from "@/components/seller-catalog-connections";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import { sellerCatalogConnectionView } from "@/modules/catalog/seller-catalog-connection";

export const dynamic = "force-dynamic";

export default async function SellerIntegrationsPage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;
  if (!session?.roles.includes(ROLE.SELLER) || session.portal !== "seller") redirect("/seller/login");
  const seller = await prisma.sellerProfile.findUnique({ where: { userId: session.userId }, include: { catalogConnections: { orderBy: { createdAt: "desc" } } } });
  if (!seller) redirect("/seller/login");
  return <main className="dashboard-shell"><nav className="site-nav"><Link className="brand" href="/seller/dashboard"><span className="brand-mark">D</span><span>DeshDak Seller</span></Link><div className="seller-nav-links"><Link href="/seller/products">Products</Link><Link href="/seller/orders">Orders</Link><Link href="/seller/store">Store</Link><span className="dashboard-user">{session.fullName}</span></div></nav><section className="seller-integrations-page"><Link className="back-link seller-back-link" href="/seller/dashboard">← Back to dashboard</Link><p className="eyebrow">AUTHORIZED CATALOG CONNECTIONS</p><h1>Connect your existing catalog safely.</h1><p className="seller-catalog-principle">Request an official read-only API connection without sending credentials. DeshDak reviews ownership, data rights, security, and technical readiness before any future synchronization.</p><aside className="integration-lock-banner"><b>Synchronization is not active.</b><span>This workspace records consent and prepares configuration. Manual product entry and CSV import remain available while the reviewed adapter and production secret manager are pending.</span></aside><SellerCatalogConnectionWorkspace approved={seller.status === "APPROVED"} connections={seller.catalogConnections.map((connection) => sellerCatalogConnectionView(connection))} /></section></main>;
}
