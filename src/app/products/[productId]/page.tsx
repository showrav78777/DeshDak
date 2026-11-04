import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { AddToCartButton } from "@/components/add-to-cart-button";
import { ActivityBeacon } from "@/components/activity-beacon";
import { IdentifierPanel } from "@/components/identifier-panel";
import { MarketRecommendations } from "@/components/market-recommendations";
import { ProductMediaGallery } from "@/components/product-media-gallery";
import { ProductShippingSelector } from "@/components/product-shipping-selector";
import { StoreHeader } from "@/components/store-header";
import { WishlistButton } from "@/components/wishlist-button";
import { prisma } from "@/lib/prisma";
import { serverMarketCountry } from "@/lib/customer-market";
import { formatMarketMoney, getMarketMoneyContext } from "@/lib/market-money";
import { getServerSession } from "@/lib/server-session";
import { hasRuntimeReadyPaymentOption } from "@/modules/payments/availability";
import { publicMediaUrl } from "@/modules/reels/media";

function stockUnavailable(value: string | null) {
  const stock = value?.toLowerCase().replaceAll("_", " ") ?? "";
  return stock.includes("out of stock") || stock.includes("unavailable") || stock.includes("sold out");
}

// Safe fallback for a deployment where the application update reaches the
// storefront before its optional planning-estimate migration. These are
// fictional, non-payable planning figures; the database values replace them
// immediately once the migration is applied.
function routePlanningFallback(origin: string, destination: string, serviceName: string) {
  const service = serviceName.toLowerCase();
  const rate = origin === "CN" && destination === "BD" ? service.includes("sea") ? 260 : 800
    : origin === "CN" && destination === "US" ? service.includes("sea") ? 680 : 1950
      : origin === "CN" && destination === "AU" ? service.includes("sea") ? 620 : 1750
        : origin === "BD" && destination === "US" ? 2100
          : origin === "BD" && destination === "AU" ? 2200 : null;
  return rate === null ? null : { rate, lastMile: destination === "BD" ? 90 : destination === "US" ? 250 : 220, handling: destination === "BD" ? 50 : 200, minimum: destination === "BD" ? 500 : 1800 };
}

const getPublicProduct = cache(async (productId: string) => prisma.product.findFirst({
  where: { id: productId, status: "ACTIVE", complianceStatus: "CLEAR", deletedAt: null, category: { is: { isActive: true } } },
  select: {
    id: true,
    productCode: true,
    titleEn: true,
    titleBn: true,
    shortDescription: true,
    description: true,
    highlights: true,
    brand: true,
    modelNumber: true,
    originCountryCode: true,
    isInternationallyAvailable: true,
    minimumOrderQuantity: true,
    sampleAvailable: true,
    customizationAvailable: true,
    productionLeadDaysMin: true,
    productionLeadDaysMax: true,
    sellingUnit: true,
    packageContents: true,
    returnPolicy: true,
    warrantyInfo: true,
    completenessScore: true,
    category: { select: { id: true, slug: true, nameEn: true } },
    sellerProfile: { select: { businessName: true, storeSlug: true, status: true, processingDays: true } },
    media: { where: { status: "READY" }, select: { id: true, kind: true, storageKey: true, mimeType: true, altText: true, caption: true, isPrimary: true }, orderBy: [{ isPrimary: "desc" as const }, { sortOrder: "asc" as const }] },
    variants: { select: { id: true, sku: true, attributes: true, priceBdt: true, priceCurrency: true, inventoryQuantity: true, stockStatus: true, weightGrams: true }, orderBy: { createdAt: "asc" as const } },
  },
}));

export async function generateMetadata({ params }: PageProps<"/products/[productId]">): Promise<Metadata> {
  const { productId } = await params;
  const product = await getPublicProduct(productId);
  if (!product || (product.sellerProfile && product.sellerProfile.status !== "APPROVED")) {
    return { title: "Product unavailable", robots: { index: false, follow: false } };
  }
  const description = (product.shortDescription ?? product.description ?? `View ${product.titleEn} and its approved product information on DeshDak.`).trim().slice(0, 160);
  const canonical = `/products/${encodeURIComponent(product.id)}`;
  return {
    title: product.titleEn,
    description,
    alternates: { canonical },
    openGraph: { title: product.titleEn, description, url: canonical },
  };
}

export default async function PublicProductDetailPage({ params }: PageProps<"/products/[productId]">) {
  const [{ productId }, session] = await Promise.all([params, getServerSession()]);
  const product = await getPublicProduct(productId);
  if (!product || (product.sellerProfile && product.sellerProfile.status !== "APPROVED")) notFound();
  const marketCountry = await serverMarketCountry(session);
  const money = await getMarketMoneyContext(marketCountry, session?.roles.includes("customer_business") ? "BUSINESS" : "PERSONAL");
  const quickPurchaseVariant = product.variants.find((variant) => variant.priceBdt && !stockUnavailable(variant.stockStatus) && variant.inventoryQuantity !== 0) ?? null;
  const laneWhere = { isActive: true, financeApproved: true, complianceApproved: true, operationsApproved: true, originCountry: { isoCode: product.originCountryCode, isActive: true }, destinationCountry: { isoCode: marketCountry, isActive: true } };
  const laneBaseSelect = { id: true, name: true, checkoutEnabled: true, transitDaysMin: true, transitDaysMax: true, originCountry: { select: { name: true } }, destinationCountry: { select: { isoCode: true, name: true, paymentMethods: { where: { checkoutEnabled: true, financeApproved: true, complianceApproved: true, refundsApproved: true, reconciliationApproved: true, paymentMethod: { is: { isActive: true } } }, select: { customerCurrency: true, paymentMethod: { select: { adapterCode: true } } } } } } } as const;
  const destinationLanes = product.isInternationallyAvailable ? await prisma.shippingLane.findMany({
    where: laneWhere,
    select: { ...laneBaseSelect, estimatedRatePerKgBdt: true, estimatedLastMileRatePerKgBdt: true, estimatedHandlingFeeBdt: true, estimatedMinimumChargeBdt: true },
    orderBy: [{ transitDaysMin: "asc" }, { name: "asc" }],
  }).catch(async () => prisma.shippingLane.findMany({ where: laneWhere, select: laneBaseSelect, orderBy: [{ transitDaysMin: "asc" }, { name: "asc" }] })) : [];
  const routePlans = await Promise.all(destinationLanes.map(async (lane) => ({ ...lane, checkoutReady: lane.checkoutEnabled && await hasRuntimeReadyPaymentOption(prisma, lane.destinationCountry.paymentMethods) })));
  const destinations = routePlans.filter((lane) => lane.checkoutReady);
  const shippingLaneViews = routePlans.map((lane) => {
    const persisted = "estimatedRatePerKgBdt" in lane && lane.estimatedRatePerKgBdt ? {
      rate: Number(lane.estimatedRatePerKgBdt),
      lastMile: "estimatedLastMileRatePerKgBdt" in lane && lane.estimatedLastMileRatePerKgBdt ? Number(lane.estimatedLastMileRatePerKgBdt) : 0,
      handling: "estimatedHandlingFeeBdt" in lane && lane.estimatedHandlingFeeBdt ? Number(lane.estimatedHandlingFeeBdt) : 0,
      minimum: "estimatedMinimumChargeBdt" in lane && lane.estimatedMinimumChargeBdt ? Number(lane.estimatedMinimumChargeBdt) : 0,
    } : routePlanningFallback(product.originCountryCode, marketCountry, lane.name);
    return { id: lane.id, name: lane.name, transitDaysMin: lane.transitDaysMin, transitDaysMax: lane.transitDaysMax, originName: lane.originCountry.name, destinationName: lane.destinationCountry.name, estimatedRateBdtPerKg: persisted?.rate ?? null, estimatedLastMileRateBdtPerKg: persisted?.lastMile ?? null, estimatedHandlingFeeBdt: persisted?.handling ?? null, estimatedMinimumChargeBdt: persisted?.minimum ?? null, packedWeightGrams: quickPurchaseVariant?.weightGrams, checkoutReady: lane.checkoutReady };
  });
  // These values exist solely so the seeded [Demo] China-to-Bangladesh listings
  // can demonstrate the rate-selector UI. They are never used for checkout,
  // order pricing, or a customer invoice.
  const demoShippingRates = product.titleEn.startsWith("[Demo]") && product.originCountryCode === "CN" && marketCountry === "BD" ? [
    { id: "demo-air-standard", name: "DeshDak demo standard air cargo", transitDaysMin: 10, transitDaysMax: 15, originName: "China origin warehouse", destinationName: "Bangladesh", demoRateBdtPerKg: 800, demoOnly: true },
    { id: "demo-air-special", name: "DeshDak demo special-category air cargo", transitDaysMin: 10, transitDaysMax: 15, originName: "China origin warehouse", destinationName: "Bangladesh", demoRateBdtPerKg: 1150, demoOnly: true },
    { id: "demo-air-postal", name: "DeshDak demo postal air", transitDaysMin: 9, transitDaysMax: 30, originName: "China origin warehouse", destinationName: "Bangladesh", demoRateBdtPerKg: 2775.63, demoOnly: true },
  ] : [];
  const [reviews, reviewSummary, wishlistItem] = await Promise.all([
    prisma.productReview.findMany({ where: { productId: product.id, status: "PUBLISHED" }, select: { id: true, rating: true, title: true, body: true, verifiedPurchase: true, publishedAt: true, customer: { select: { fullName: true } } }, orderBy: [{ publishedAt: "desc" }, { id: "desc" }], take: 10 }),
    prisma.productReview.aggregate({ where: { productId: product.id, status: "PUBLISHED" }, _count: { _all: true }, _avg: { rating: true } }),
    session ? prisma.wishlistItem.findUnique({ where: { userId_productId: { userId: session.userId, productId: product.id } }, select: { id: true } }) : Promise.resolve(null),
  ]);
  const galleryMedia = product.media.map((media) => ({ ...media, url: publicMediaUrl(media.storageKey) }));
  return <main className="public-catalog">
    {session ? <ActivityBeacon eventType="PRODUCT_VIEW" objectId={product.id} path={`/products/${product.id}`} /> : null}
    <StoreHeader session={session} />
    <div className="product-wishlist-action" style={{ maxWidth: 1200, margin: "22px auto 0", padding: "0 28px" }}><div style={{ maxWidth: 220, marginLeft: "auto" }}><WishlistButton productId={product.id} initialSaved={Boolean(wishlistItem)} /></div></div>
    <section className="public-product-detail"><Link className="back-to-orders" href="/products">← Continue browsing</Link><div className="product-detail-breadcrumb"><span>DeshDak marketplace</span><span aria-hidden="true">/</span><span>{product.category?.nameEn ?? "Products"}</span><span aria-hidden="true">/</span><b>{product.originCountryCode === "BD" ? "Bangladesh store" : "Global sourcing"}</b></div><div className="public-product-detail-grid"><ProductMediaGallery media={galleryMedia} productTitle={product.titleEn} /><article className="product-purchase-panel"><p className="eyebrow">APPROVED PRODUCT · {product.originCountryCode === "BD" ? "MADE IN BANGLADESH" : "INTERNATIONAL SOURCING CATALOG"}</p><h1>{product.titleEn}</h1>{product.titleBn ? <h2>{product.titleBn}</h2> : null}<p className="seller-line">Sold on DeshDak by {product.sellerProfile?.storeSlug ? <Link href={`/stores/${product.sellerProfile.storeSlug}`}>{product.sellerProfile.businessName}</Link> : product.sellerProfile?.businessName ?? "an approved catalog seller"}</p>{product.shortDescription ? <p className="product-summary">{product.shortDescription}</p> : null}<div className="product-trust-row"><span>Admin-reviewed listing</span><span>{product.completenessScore}% information complete</span>{product.sampleAvailable ? <span>Samples available</span> : null}</div>{product.highlights.length ? <ul className="product-highlights">{product.highlights.map((highlight) => <li key={highlight}>{highlight}</li>)}</ul> : null}<div className="product-commerce-facts"><div><small>Minimum order</small><b>{product.minimumOrderQuantity} {product.sellingUnit ?? "unit"}{product.minimumOrderQuantity === 1 ? "" : "s"}</b></div><div><small>Production lead time</small><b>{product.productionLeadDaysMin !== null && product.productionLeadDaysMax !== null ? `${product.productionLeadDaysMin}–${product.productionLeadDaysMax} days` : "Confirm with seller"}</b></div><div><small>Customization</small><b>{product.customizationAvailable ? "Available" : "Not listed"}</b></div></div>{quickPurchaseVariant ? <section className="product-quick-purchase"><div><small>Starting from</small><b>{formatMarketMoney(quickPurchaseVariant.priceBdt!, money)}</b><span>Select a variant and quantity below to continue.</span></div><AddToCartButton productVariantId={quickPurchaseVariant.id} quantity={Math.min(product.minimumOrderQuantity, 99)} availableStock={quickPurchaseVariant.inventoryQuantity} /></section> : null}<div className="public-variant-list"><div className="variant-list-heading"><div><p className="eyebrow">CHOOSE YOUR OPTION</p><h3>Available options</h3></div><small>Price and stock update as you choose</small></div>{product.variants.length ? product.variants.map((variant) => <div key={variant.id}><span>{variant.attributes ? Object.values(variant.attributes as Record<string, unknown>).join(" · ") : variant.sku ?? "Standard option"}</span><b>{variant.priceBdt ? formatMarketMoney(variant.priceBdt, money) : "Request price"}</b><small>{variant.stockStatus?.replaceAll("_", " ") ?? "Confirm availability"}{variant.inventoryQuantity !== null ? ` · ${variant.inventoryQuantity} available` : ""}{variant.weightGrams ? ` · ${variant.weightGrams} g packed` : ""}</small><AddToCartButton productVariantId={variant.id} disabled={stockUnavailable(variant.stockStatus) || variant.inventoryQuantity === 0} availableStock={variant.inventoryQuantity} quantity={Math.min(product.minimumOrderQuantity, 99)} /></div>) : <p>Price and variant will be confirmed during quotation.</p>}</div><div className="public-order-actions"><Link className="button primary" href={`/buy-ship?productId=${product.id}`}>Request quote or sample</Link><p>Need a different quantity or product? Use Buy &amp; Ship and the sourcing team will confirm it before payment.</p></div></article><aside className="product-order-sidebar" aria-label="Delivery and order summary"><div className="product-delivery-card"><ProductShippingSelector destinationLabel={marketCountry === "BD" ? "Bangladesh" : marketCountry} domestic={product.originCountryCode === "BD" && marketCountry === "BD"} lanes={shippingLaneViews} demoRates={demoShippingRates} /><dl className="product-cost-summary"><div><dt>Product price</dt><dd>{quickPurchaseVariant?.priceBdt ? `From ${formatMarketMoney(quickPurchaseVariant.priceBdt, money)}` : "Quote required"}</dd></div><div><dt>Origin local delivery</dt><dd>{product.originCountryCode === "BD" ? "Included or confirmed by courier" : "Confirmed at quote"}</dd></div><div><dt>International shipping</dt><dd>{product.originCountryCode === marketCountry ? "Not required for local order" : "See selected route above; final after measurement"}</dd></div></dl>{demoShippingRates.length ? <p className="product-demo-rate-note"><b>Demo pricing enabled.</b> These route rates are illustrative test data and are not used for checkout or an invoice.</p> : null}<p className="product-price-note">The product price is visible now. Delivery, duties and handling are shown separately before payment—never hidden in the item price. Your final shipping amount is set only after warehouse measurement.</p>{quickPurchaseVariant ? <AddToCartButton productVariantId={quickPurchaseVariant.id} quantity={Math.min(product.minimumOrderQuantity, 99)} availableStock={quickPurchaseVariant.inventoryQuantity} /> : <Link className="button primary" href={`/buy-ship?productId=${product.id}`}>Request a quote</Link>}</div><div className="product-assurance-card"><b>Buy with confidence</b><span>✓ Destination estimate before ordering</span><span>✓ Final shipping after warehouse measurement</span><span>✓ Customer approval before payment</span></div></aside></div><div className="product-detail-sections"><section className="product-description-section"><p className="eyebrow">PRODUCT DESCRIPTION</p><h2>About this product</h2><p>{product.description ?? "Detailed information will be confirmed before the order is placed."}</p></section><section className="product-specification-section"><p className="eyebrow">AT A GLANCE</p><h2>Specifications</h2><dl><div><dt>Category</dt><dd>{product.category?.nameEn ?? "Approved catalog"}</dd></div><div><dt>Brand</dt><dd>{product.brand ?? "Not specified"}</dd></div><div><dt>Model</dt><dd>{product.modelNumber ?? "Not specified"}</dd></div><div><dt>Origin</dt><dd>{product.originCountryCode === "BD" ? "Bangladesh" : product.originCountryCode}</dd></div><div><dt>Selling unit</dt><dd>{product.sellingUnit ?? "Unit"}</dd></div></dl></section><section id="shipping-options" className="product-fulfilment-section"><p className="eyebrow">FULFILMENT</p><h2>Packaging and delivery</h2><p>{product.packageContents ?? "Package contents will be confirmed before purchase."}</p>{product.isInternationallyAvailable ? <div className="international-availability"><b>International delivery through DeshDak</b><span>{routePlans.length ? `Configured routes for ${[...new Set(routePlans.map(({ destinationCountry }) => destinationCountry.name))].join(", ")}.` : "Destination lanes are being configured by the administrator."}</span>{product.sellerProfile ? <small>Seller preparation baseline: about {product.sellerProfile.processingDays} day{product.sellerProfile.processingDays === 1 ? "" : "s"}.</small> : null}</div> : null}</section><section><p className="eyebrow">AFTER YOUR ORDER</p><h2>Returns and warranty</h2><p><b>Seller return information:</b> {product.returnPolicy ?? "No additional seller return terms have been provided. DeshDak's applicable order and claims policies still govern."}</p><p><b>Warranty:</b> {product.warrantyInfo ?? "No separate product warranty has been listed."}</p></section><section className="product-identity-section"><p className="eyebrow">VERIFIED CATALOG</p><h2>Product identity</h2>{product.productCode ? <IdentifierPanel code={product.productCode} entity="product" title="DeshDak product QR & barcode" /> : <p>Identifier assignment pending.</p>}</section></div></section>
    <MarketRecommendations marketCountry={marketCountry} businessCustomer={Boolean(session?.roles.includes("customer_business"))} excludeProductId={product.id} categoryId={product.category?.id} />
    <section className="product-shipping-estimate" aria-labelledby="product-shipping-heading">
      <div className="product-shipping-heading">
        <div><p className="eyebrow">ESTIMATED LOGISTICS</p><h2 id="product-shipping-heading">Understand shipping before you order</h2></div>
        <span>{product.isInternationallyAvailable ? destinations.length ? `${destinations.length} shipping service${destinations.length === 1 ? "" : "s"} ready` : "Route confirmation required" : "Domestic market only"}</span>
      </div>
      {product.isInternationallyAvailable ? <><div className="product-shipping-methods"><article><span aria-hidden="true">✈</span><div><b>Air shipping</b><small>Faster delivery · estimated by chargeable weight</small></div></article><article><span aria-hidden="true">🚢</span><div><b>Sea shipping</b><small>Economy delivery · estimated by weight or volume</small></div></article></div><p className="shipping-estimate-notice"><b>Origin local delivery is separate and transparent.</b> For China products, supplier-to-China-warehouse delivery is included in the approved product quote when applicable. <b>International and Bangladesh courier delivery are finalised after warehouse measurement.</b> The final charge uses actual/package volumetric weight and the selected route.</p><small className="shipping-route-note">{destinations.length ? `Currently configured destinations: ${[...new Set(destinations.map(({ destinationCountry }) => destinationCountry.name))].join(", ")}.` : "The final route, method, delivery window and price will be confirmed through DeshDak before payment."}</small></> : <p className="shipping-estimate-notice"><b>Bangladesh local delivery:</b> the seller or courier confirms the delivery charge from package weight. No international shipping charge applies to a Bangladesh-to-Bangladesh order.</p>}
    </section>
    <section className="public-product-reviews"><div className="section-heading"><div><p className="eyebrow">VERIFIED PURCHASE REVIEWS</p><h2>{reviewSummary._count._all ? `${Number(reviewSummary._avg.rating?.toFixed(1))} out of 5` : "No published reviews yet"}</h2><p>{reviewSummary._count._all} moderated review{reviewSummary._count._all === 1 ? "" : "s"}</p></div></div>{reviews.length ? <div className="product-review-grid">{reviews.map((review) => <article key={review.id}><b aria-label={`${review.rating} out of 5 stars`}>{"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}</b><h3>{review.title ?? "Verified customer review"}</h3><p>{review.body}</p><small>{review.customer.fullName.trim().split(/\s+/)[0] || "Customer"} · Verified purchase · {review.publishedAt?.toLocaleDateString()}</small></article>)}</div> : <p className="empty-copy">Reviews from delivered orders will appear here only after moderation.</p>}</section>
  </main>;
}
