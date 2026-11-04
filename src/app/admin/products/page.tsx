import { type Prisma } from "@prisma/client";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { IdentifierPanel } from "@/components/identifier-panel";
import { ProductReviewActions } from "@/components/product-review-actions";
import { ProductRevisionReviewActions } from "@/components/product-revision-review-actions";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

export const dynamic = "force-dynamic";

function record(value: Prisma.JsonValue) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, fallback = "Not set") {
  return typeof value === "string" && value ? value : fallback;
}

export default async function AdminProductsPage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") redirect("/");
  const [products, revisions, categories] = await Promise.all([
    prisma.product.findMany({ where: { status: "PENDING_REVIEW", sellerProfileId: { not: null }, deletedAt: null }, include: { category: { select: { id: true, nameEn: true, isActive: true } }, sellerProfile: { select: { businessName: true, user: { select: { email: true } } } }, catalogImportRow: { select: { rowNumber: true, catalogImportId: true } }, variants: true }, orderBy: { createdAt: "asc" } }),
    prisma.productRevision.findMany({ where: { status: "PENDING_REVIEW" }, include: { product: { select: { titleEn: true, productCode: true, version: true, status: true } }, sellerProfile: { select: { businessName: true, user: { select: { email: true } } } } }, orderBy: { submittedAt: "asc" } }),
    prisma.category.findMany({ where: { isActive: true }, select: { id: true, nameEn: true }, orderBy: [{ sortOrder: "asc" }, { nameEn: "asc" }] }),
  ]);
  const categoryNames = new Map(categories.map((category) => [category.id, category.nameEn]));

  return <main className="dashboard-shell"><nav className="site-nav"><Link className="brand" href="/admin"><span className="brand-mark">D</span><span>DeshDak Admin</span></Link></nav><section className="admin-content"><p className="eyebrow">PRODUCT MODERATION</p><h1>Review seller products.</h1><p className="admin-intro">New products remain private. Changes to an active listing are held as a separate revision, so the last approved version stays available to customers until approval.</p>
    {revisions.length ? <section className="moderation-section"><h2>Listing changes ({revisions.length})</h2><div className="seller-review-list">{revisions.map((revision) => {
      const proposed = record(revision.productPayload);
      const variant = record(revision.variantPayload);
      return <article className="seller-review-card revision-review-card" key={revision.id}><div><p className="eyebrow">CHANGE REQUEST · {revision.sellerProfile.businessName}</p><h2>{text(proposed.titleEn, revision.product.titleEn)}</h2><p>{text(proposed.description)}</p><div className="revision-safety-note"><b>Current live title: {revision.product.titleEn}</b><br />Live status: {revision.product.status.replaceAll("_", " ")} · product version {revision.product.version} · revision based on version {revision.baseProductVersion}</div><dl><div><dt>Category</dt><dd>{categoryNames.get(text(proposed.categoryId, "")) ?? "Inactive or missing"}</dd></div><div><dt>Price</dt><dd>৳{String(variant.priceBdt ?? "Not set")}</dd></div><div><dt>Inventory</dt><dd>{String(variant.inventoryQuantity ?? "Not set")}</dd></div><div><dt>Stock</dt><dd>{text(variant.stockStatus).replaceAll("_", " ")}</dd></div><div><dt>Packed weight</dt><dd>{variant.weightGrams ? `${String(variant.weightGrams)} g` : "Not set"}</dd></div><div><dt>Dimensions</dt><dd>{variant.lengthMm && variant.widthMm && variant.heightMm ? `${String(variant.lengthMm)} × ${String(variant.widthMm)} × ${String(variant.heightMm)} mm` : "Not set"}</dd></div><div><dt>International</dt><dd>{proposed.isInternationallyAvailable ? "Requested" : "No"}</dd></div><div><dt>Seller contact</dt><dd>{revision.sellerProfile.user.email}</dd></div></dl>{revision.product.productCode ? <IdentifierPanel code={revision.product.productCode} compact entity="product" title={text(proposed.titleEn, revision.product.titleEn)} /> : null}</div><ProductRevisionReviewActions revisionId={revision.id} version={revision.version} /></article>;
    })}</div></section> : null}
    <section className="moderation-section"><h2>New products ({products.length})</h2>{products.length ? <div className="seller-review-list">{products.map((product) => <article className="seller-review-card" key={product.id}><div><p className="eyebrow">NEW PRODUCT · {product.sellerProfile?.businessName}</p><h2>{product.titleEn}</h2><p>{product.description}</p><dl><div><dt>Category</dt><dd>{product.category?.nameEn ?? "Not assigned"}{product.category && !product.category.isActive ? " · inactive" : ""}</dd></div><div><dt>Origin</dt><dd>{product.originCountryCode === "BD" ? "Bangladesh" : product.originCountryCode}</dd></div><div><dt>Price</dt><dd>৳{product.variants[0]?.priceBdt?.toString() ?? "Not set"}</dd></div><div><dt>Inventory</dt><dd>{product.variants[0]?.inventoryQuantity ?? "Not set"}</dd></div><div><dt>Stock</dt><dd>{product.variants[0]?.stockStatus?.replaceAll("_", " ") ?? "Not set"}</dd></div><div><dt>Packed weight</dt><dd>{product.variants[0]?.weightGrams ? `${product.variants[0].weightGrams} g` : "Not set"}</dd></div><div><dt>Dimensions</dt><dd>{product.variants[0]?.lengthMm && product.variants[0]?.widthMm && product.variants[0]?.heightMm ? `${product.variants[0].lengthMm} × ${product.variants[0].widthMm} × ${product.variants[0].heightMm} mm` : "Not set"}</dd></div><div><dt>HS code</dt><dd>{product.hsCode ?? "Needs compliance classification"}</dd></div><div><dt>International</dt><dd>{product.isInternationallyAvailable ? "Requested" : "No"}</dd></div><div><dt>Seller contact</dt><dd>{product.sellerProfile?.user.email}</dd></div></dl>{product.productCode ? <IdentifierPanel code={product.productCode} compact entity="product" title={product.titleEn} /> : <p>Identifier assignment pending.</p>}</div><ProductReviewActions categories={categories} currentCategoryId={product.category?.isActive ? product.category.id : null} productId={product.id} /></article>)}</div> : <div className="dashboard-card"><h2>No pending products</h2><p>Approved sellers’ new submissions will appear here.</p></div>}</section>
  </section></main>;
}
