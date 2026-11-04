import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { IdentifierPanel } from "@/components/identifier-panel";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SellerProductsPage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;
  if (!session?.roles.includes(ROLE.SELLER) || session.portal !== "seller") redirect("/seller/login");
  const seller = await prisma.sellerProfile.findUnique({
    where: { userId: session.userId },
    include: { products: { include: { variants: { take: 1 }, media: { where: { status: "READY" }, select: { id: true } }, category: { select: { nameEn: true } }, revisions: { where: { status: "PENDING_REVIEW" }, select: { id: true, submittedAt: true }, take: 1 } }, orderBy: { createdAt: "desc" } } },
  });
  if (!seller) redirect("/seller/login");

  return <main className="dashboard-shell">
    <nav className="site-nav"><Link className="brand" href="/seller/dashboard"><span className="brand-mark">D</span><span>DeshDak Seller</span></Link><div className="seller-nav-links"><Link href="/seller/dashboard">Dashboard</Link><Link href="/seller/orders">Orders</Link><span className="dashboard-user">{session.fullName}</span></div></nav>
    <section className="seller-products-content">
      <div className="seller-catalog-heading"><div><p className="eyebrow">YOUR CROSSLY STOREFRONT · WORLDWIDE CUSTOMERS</p><h1>Product catalog</h1><p className="seller-catalog-principle">Create and maintain products inside DeshDak. Approved listings remain live while later edits pass through Admin review.</p></div>{seller.status === "APPROVED" ? <div className="seller-catalog-actions"><Link className="button secondary" href="/seller/products/import">Import CSV</Link><Link className="button primary" href="/seller/products/new">Add product</Link></div> : null}</div>
      {seller.status !== "APPROVED" ? <div className="dashboard-card"><h2>Seller approval required</h2><p>You can submit products after an administrator approves your seller account.</p></div> : seller.products.length ? <div className="seller-catalog-list">{seller.products.map((product) => {
        const variant = product.variants[0];
        const pendingRevision = product.revisions[0];
        return <article key={product.id} className="seller-catalog-row"><div className="seller-catalog-row-main"><div><p className="eyebrow">{product.category?.nameEn ?? "CATEGORY PENDING"}</p><h2>{product.titleEn}</h2><p>{variant?.priceBdt ? `৳${variant.priceBdt.toString()}` : "Price pending"} · {variant?.inventoryQuantity ?? "Quantity pending"} available · {product.isInternationallyAvailable ? "Worldwide" : "Local only"}</p><span className="catalog-completeness"><i style={{ width: `${product.completenessScore}%` }} />{product.completenessScore}% information complete</span></div><div className="seller-product-state"><b className={`status-${product.status.toLowerCase()}`}>{product.status.replaceAll("_", " ")}</b>{pendingRevision ? <span className="revision-pending">Changes awaiting Admin review</span> : null}<small>{product.media.length} approved media</small></div></div>{product.reviewNote ? <p className="seller-review-note">Latest Admin note: {product.reviewNote}</p> : null}<div className="seller-catalog-actions"><Link className="button secondary" href={`/seller/products/${product.id}`}>{pendingRevision || product.status === "PENDING_REVIEW" ? "View submission" : "Edit product"}</Link>{product.status === "ACTIVE" ? <Link className="button secondary" href={`/products/${product.id}`}>View public page</Link> : null}</div>{product.productCode ? <IdentifierPanel code={product.productCode} compact entity="product" title={product.titleEn} /> : null}</article>;
      })}</div> : <div className="dashboard-card"><h2>No products yet</h2><p>Add your first product with complete pricing, inventory, packaging, and export details.</p><Link className="button primary" href="/seller/products/new">Add first product</Link></div>}
    </section>
  </main>;
}
