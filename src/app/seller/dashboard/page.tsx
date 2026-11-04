import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

export default async function SellerDashboardPage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;
  if (!session?.roles.includes(ROLE.SELLER) || session.portal !== "seller") redirect("/seller/login");
  const seller = await prisma.sellerProfile.findUnique({ where: { userId: session.userId }, select: { businessName: true, storeCode: true, storeSlug: true, status: true, shipsInternationally: true, sellerOrders: { where: { status: { in: ["APPROVED", "SELLER_PREPARING", "READY_FOR_COLLECTION"] } }, select: { id: true } } } });
  if (!seller) redirect("/seller/login");
  return <main className="dashboard-shell"><nav className="site-nav"><Link className="brand" href="/"><span className="brand-mark">D</span><span>DeshDak</span></Link><span className="dashboard-user">{session.fullName}</span></nav><section className="dashboard-content"><p className="eyebrow">SELLER PORTAL · BANGLADESH EXPORT</p><h1>Welcome, {seller.businessName}.</h1><div className="dashboard-card"><p className="eyebrow">APPLICATION STATUS</p><h2>{seller.status.replaceAll("_", " ")}</h2><p>{seller.status === "APPROVED" ? "Your seller account is approved. Submit Bangladesh products and prepare payment-verified customer orders after administrator review." : "Your application is being reviewed. Product submission becomes available after approval."}</p>{seller.status === "APPROVED" ? <div className="hero-actions"><Link className="button primary" href="/seller/orders">Orders ({seller.sellerOrders.length})</Link><Link className="button secondary" href="/seller/products">Manage products</Link><Link className="button secondary" href="/seller/reels">Product Reels</Link><Link className="button secondary" href="/seller/integrations">Catalog API connections</Link><Link className="button secondary" href="/seller/store">Store settings</Link>{seller.storeSlug ? <Link className="button secondary" href={`/stores/${seller.storeSlug}`}>View public store</Link> : null}</div> : null}</div></section></main>;
}
