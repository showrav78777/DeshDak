import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SellerStoreForm } from "@/components/seller-store-form";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SellerStorePage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;
  if (!session?.roles.includes(ROLE.SELLER) || session.portal !== "seller") redirect("/seller/login");
  const seller = await prisma.sellerProfile.findUnique({ where: { userId: session.userId }, select: { businessName: true, storeSlug: true, storeDescription: true, processingDays: true, originCountryCode: true, shipsInternationally: true, status: true, version: true, storeRevisions: { where: { status: "PENDING_REVIEW" }, select: { businessName: true, storeDescription: true, processingDays: true, submittedAt: true }, take: 1 } } });
  if (!seller) redirect("/seller/login");
  if (seller.status !== "APPROVED") redirect("/seller/dashboard");
  const pending = seller.storeRevisions[0];
  const values = pending ? { businessName: pending.businessName, storeDescription: pending.storeDescription, processingDays: pending.processingDays } : { businessName: seller.businessName, storeDescription: seller.storeDescription ?? "", processingDays: seller.processingDays };
  return <main className="dashboard-shell"><nav className="site-nav"><Link className="brand" href="/seller/dashboard"><span className="brand-mark">D</span><span>DeshDak Seller</span></Link><div className="seller-nav-links"><Link href="/seller/products">Products</Link><Link href="/seller/orders">Orders</Link><span className="dashboard-user">{session.fullName}</span></div></nav><section className="seller-store-settings"><Link className="back-link seller-back-link" href="/seller/dashboard">← Back to dashboard</Link><p className="eyebrow">PUBLIC STOREFRONT · BANGLADESH</p><h1>Store settings</h1><p className="seller-catalog-principle">Manage the information worldwide customers see. Public identity changes require Admin review, and the approved store remains unchanged while review is pending.</p><div className="seller-store-grid"><section className="product-form-card"><h2>{pending ? "Pending proposal" : "Public store information"}</h2>{pending ? <div className="seller-revision-banner"><b>Awaiting Admin review</b><p>The form shows your submitted proposal and is locked until it is approved or rejected.</p></div> : null}<SellerStoreForm initialValues={values} sellerVersion={seller.version} readOnly={Boolean(pending)} /></section><aside className="seller-store-policy"><h2>Protected store settings</h2><dl><div><dt>Permanent store URL</dt><dd>/stores/{seller.storeSlug}</dd></div><div><dt>Origin</dt><dd>{seller.originCountryCode === "BD" ? "Bangladesh" : seller.originCountryCode}</dd></div><div><dt>International selling</dt><dd>{seller.shipsInternationally ? "Enabled by approved seller configuration" : "Disabled"}</dd></div></dl><p>The store URL is kept stable for customer bookmarks and SEO. Business verification, international eligibility, licence, TIN/NID, and address changes require a separate compliance workflow.</p>{seller.storeSlug ? <Link className="button secondary" href={`/stores/${seller.storeSlug}`}>View approved public store</Link> : null}<div className="secure-media-gate"><b>Logo and banner</b><p>Secure uploads will be enabled only after private object storage, malware scanning, metadata removal, and approved image delivery are configured.</p></div></aside></div></section></main>;
}
