import Link from "next/link";
import { redirect } from "next/navigation";
import { SellerCatalogImport } from "@/components/seller-catalog-import";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { getServerSession } from "@/lib/server-session";

export const dynamic = "force-dynamic";

export default async function SellerCatalogImportPage() {
  const session = await getServerSession();
  if (!session?.roles.includes(ROLE.SELLER) || session.portal !== "seller") redirect("/seller/login");
  const [seller, categories] = await Promise.all([
    prisma.sellerProfile.findUnique({ where: { userId: session.userId }, select: { status: true, catalogImports: { select: { id: true, status: true, originalFilename: true, totalRows: true, validRows: true, invalidRows: true, createdAt: true, confirmedAt: true }, orderBy: { createdAt: "desc" }, take: 8 } } }),
    prisma.category.findMany({ where: { isActive: true }, select: { slug: true }, orderBy: [{ sortOrder: "asc" }, { nameEn: "asc" }] }),
  ]);
  if (!seller || seller.status !== "APPROVED") redirect("/seller/products");
  return <main className="dashboard-shell"><nav className="site-nav"><Link className="brand" href="/seller/products"><span className="brand-mark">D</span><span>DeshDak Seller</span></Link><span className="dashboard-user">{session.fullName}</span></nav><section className="seller-catalog-import-page"><Link className="back-link seller-back-link" href="/seller/products">← Back to catalog</Link><p className="eyebrow">CONTROLLED CATALOG IMPORT</p><h1>Import products from CSV</h1><p className="seller-catalog-principle">Preview, map, and correct your catalog before creating anything. Confirmation is atomic, and every imported listing enters Admin review.</p><SellerCatalogImport categorySlugs={categories.map((category) => category.slug)} />{seller.catalogImports.length ? <section className="catalog-import-history"><h2>Recent imports</h2>{seller.catalogImports.map((item) => <article key={item.id}><div><b>{item.originalFilename ?? "Catalog CSV"}</b><small>{item.createdAt.toLocaleString()} · {item.totalRows} rows</small></div><span className={`status-${item.status.toLowerCase()}`}>{item.status.replaceAll("_", " ")}</span><small>{item.status === "COMPLETED" ? `Confirmed ${item.confirmedAt?.toLocaleString()}` : `${item.validRows} valid · ${item.invalidRows} need correction`}</small></article>)}</section> : null}</section></main>;
}
