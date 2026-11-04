import { type Prisma } from "@prisma/client";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { SellerProductForm, type SellerProductFormValues } from "@/components/seller-product-form";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import { sellerProductInputSchema } from "@/modules/catalog/seller-product-input";

export const dynamic = "force-dynamic";

function record(value: Prisma.JsonValue): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function proposedValues(productPayload: Prisma.JsonValue, variantPayload: Prisma.JsonValue): SellerProductFormValues | null {
  const product = record(productPayload);
  const variant = record(variantPayload);
  if (!product || !variant) return null;
  const parsed = sellerProductInputSchema.safeParse({
    ...product,
    ...variant,
    titleBn: typeof product.titleBn === "string" ? product.titleBn : "",
    brand: typeof product.brand === "string" ? product.brand : "",
    modelNumber: typeof product.modelNumber === "string" ? product.modelNumber : "",
    hsCode: typeof product.hsCode === "string" ? product.hsCode : "",
    returnPolicy: typeof product.returnPolicy === "string" ? product.returnPolicy : "",
    warrantyInfo: typeof product.warrantyInfo === "string" ? product.warrantyInfo : "",
  });
  return parsed.success ? parsed.data : null;
}

export default async function EditSellerProductPage({ params }: PageProps<"/seller/products/[productId]">) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;
  if (!session?.roles.includes(ROLE.SELLER) || session.portal !== "seller") redirect("/seller/login");
  const { productId } = await params;
  const [product, categories] = await Promise.all([
    prisma.product.findFirst({ where: { id: productId, deletedAt: null, sellerProfile: { userId: session.userId, status: "APPROVED" } }, include: { variants: { take: 1 }, revisions: { where: { status: "PENDING_REVIEW" }, select: { id: true, submittedAt: true, productPayload: true, variantPayload: true }, take: 1 } } }),
    prisma.category.findMany({ where: { isActive: true }, select: { id: true, nameEn: true }, orderBy: [{ sortOrder: "asc" }, { nameEn: "asc" }] }),
  ]);
  if (!product) notFound();
  const variant = product.variants[0];
  if (!variant) notFound();
  const pendingRevision = product.revisions[0];
  const editable = product.status !== "PENDING_REVIEW" && product.status !== "ARCHIVED" && !pendingRevision;
  const liveValues: SellerProductFormValues = { titleEn: product.titleEn, titleBn: product.titleBn, categoryId: product.categoryId, shortDescription: product.shortDescription, description: product.description, highlights: product.highlights, brand: product.brand, modelNumber: product.modelNumber, priceBdt: variant.priceBdt?.toString(), inventoryQuantity: variant.inventoryQuantity, stockStatus: variant.stockStatus, weightGrams: variant.weightGrams, lengthMm: variant.lengthMm, widthMm: variant.widthMm, heightMm: variant.heightMm, minimumOrderQuantity: product.minimumOrderQuantity, productionLeadDaysMin: product.productionLeadDaysMin, productionLeadDaysMax: product.productionLeadDaysMax, sellingUnit: product.sellingUnit, packageContents: product.packageContents, sampleAvailable: product.sampleAvailable, customizationAvailable: product.customizationAvailable, returnPolicy: product.returnPolicy, warrantyInfo: product.warrantyInfo, hsCode: product.hsCode, sku: variant.sku, isInternationallyAvailable: product.isInternationallyAvailable };
  const submittedValues = pendingRevision ? proposedValues(pendingRevision.productPayload, pendingRevision.variantPayload) : null;

  return <main className="dashboard-shell"><nav className="site-nav"><Link className="brand" href="/seller/products"><span className="brand-mark">D</span><span>DeshDak Seller</span></Link><span className="dashboard-user">{session.fullName}</span></nav><section className="seller-product-editor"><Link className="back-link seller-back-link" href="/seller/products">← Back to catalog</Link><p className="eyebrow">PRODUCT {product.productCode ?? ""}</p><h1>{editable ? "Edit product" : "Product submission"}</h1>{pendingRevision ? <div className="seller-revision-banner"><b>These submitted changes are awaiting Admin review.</b><p>The form below shows your pending proposal. Customers continue seeing the last approved version until Admin accepts it.</p></div> : product.status === "PENDING_REVIEW" ? <div className="seller-revision-banner"><b>This new product is awaiting its first review.</b><p>It stays private until Admin approval.</p></div> : product.status === "ARCHIVED" ? <div className="seller-revision-banner"><b>This product is archived.</b><p>Archived products cannot be edited.</p></div> : <p className="seller-catalog-principle">Submitting changes never silently replaces the live listing. Customers continue seeing the approved version until Admin accepts this revision.</p>}<div className={`product-form-card${editable ? "" : " seller-form-readonly"}`}><SellerProductForm categories={categories} productId={editable ? product.id : undefined} productVersion={editable ? product.version : undefined} readOnly={!editable} initialValues={submittedValues ?? liveValues} /></div></section></main>;
}
