import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { StoreHeader } from "@/components/store-header";
import { AddToCartButton } from "@/components/add-to-cart-button";
import { CatalogFilters, type CatalogFilterValues } from "@/components/catalog-filters";
import { CatalogSort, type CatalogSortValue } from "@/components/catalog-sort";
import { prisma } from "@/lib/prisma";
import { serverMarketCountry } from "@/lib/customer-market";
import { formatMarketMoney, getMarketMoneyContext } from "@/lib/market-money";
import { getServerSession } from "@/lib/server-session";
import { hasRuntimeReadyPaymentOption } from "@/modules/payments/availability";

export const dynamic = "force-dynamic";

const getPublicStore = cache(async (storeSlug: string) => prisma.sellerProfile.findFirst({
  where: { storeSlug, status: "APPROVED" },
  select: {
    storeCode: true,
    businessName: true,
    storeSlug: true,
    storeDescription: true,
    originCountryCode: true,
    processingDays: true,
    products: {
      where: { status: "ACTIVE", complianceStatus: "CLEAR", deletedAt: null, category: { is: { isActive: true } } },
      select: { id: true, productCode: true, titleEn: true, titleBn: true, description: true, minimumOrderQuantity: true, createdAt: true, isInternationallyAvailable: true, category: { select: { nameEn: true } }, variants: { select: { id: true, priceBdt: true, priceCurrency: true, inventoryQuantity: true, stockStatus: true }, orderBy: { priceBdt: "asc" } } },
      orderBy: { createdAt: "desc" },
    },
  },
}));

function storeCatalogFilters(params: Record<string, string | string[] | undefined>): CatalogFilterValues {
  const value = (key: string) => typeof params[key] === "string" ? params[key] as string : undefined;
  return { sort: value("sort"), minPrice: value("minPrice"), maxPrice: value("maxPrice"), priceBand: ["0-999", "1000-2499", "2500-4999", "5000-9999", "10000-plus"].includes(value("priceBand") ?? "") ? value("priceBand") : undefined, availability: ["ready", "stock"].includes(value("availability") ?? "") ? value("availability") : undefined, origin: value("origin") === "BD" ? "BD" : value("origin") === "GLOBAL" ? "GLOBAL" : undefined, delivery: value("delivery") === "international" ? "international" : undefined, recency: ["7", "30"].includes(value("recency") ?? "") ? value("recency") : undefined };
}

function catalogPriceRange(band: string | undefined) {
  return band ? ({ "0-999": [0, 999], "1000-2499": [1000, 2499], "2500-4999": [2500, 4999], "5000-9999": [5000, 9999], "10000-plus": [10000, undefined] } as Record<string, [number, number | undefined]>)[band] : undefined;
}

function filteredStoreProducts<T extends { createdAt: Date; isInternationallyAvailable: boolean; variants: { priceBdt: unknown; inventoryQuantity: number | null; stockStatus: string | null }[] }>(products: T[], filters: CatalogFilterValues) {
  const numeric = (value: string | undefined) => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : undefined;
  const [bandMin, bandMax] = catalogPriceRange(filters.priceBand) ?? [];
  const min = numeric(filters.minPrice) ?? bandMin; const max = numeric(filters.maxPrice) ?? bandMax;
  const since = filters.recency ? new Date(Date.now() - Number(filters.recency) * 86_400_000) : null;
  const matching = products.map((product) => ({ ...product, variants: product.variants.filter((variant) => {
    const price = variant.priceBdt == null ? NaN : Number(variant.priceBdt);
    if ((min !== undefined || max !== undefined) && !Number.isFinite(price)) return false;
    return !(min !== undefined && price < min) && !(max !== undefined && price > max)
      && !(filters.availability === "ready" && (variant.inventoryQuantity ?? 0) <= 0)
      && !(filters.availability === "stock" && variant.stockStatus !== "IN_STOCK");
  }) }));
  return matching.filter((product) => !((min !== undefined || max !== undefined || filters.availability) && !product.variants.length) && filters.origin !== "GLOBAL" && !(filters.delivery === "international" && !product.isInternationallyAvailable) && !(since && product.createdAt < since));
}

export async function generateMetadata({ params }: PageProps<"/stores/[storeSlug]">): Promise<Metadata> {
  const { storeSlug } = await params;
  const store = await getPublicStore(storeSlug);
  if (!store) return { title: "Store unavailable", robots: { index: false, follow: false } };
  const canonical = `/stores/${encodeURIComponent(storeSlug)}`;
  const description = (store.storeDescription ?? `Shop approved Bangladesh products from ${store.businessName} on DeshDak.`).trim().slice(0, 160);
  return {
    title: store.businessName,
    description,
    alternates: { canonical },
    openGraph: { title: `${store.businessName} on DeshDak`, description, url: canonical, type: "website" },
  };
}

export default async function PublicStorePage({ params, searchParams }: PageProps<"/stores/[storeSlug]">) {
  const [{ storeSlug }, filtersParams, session] = await Promise.all([params, searchParams, getServerSession()]);
  const [store, lanes] = await Promise.all([
    getPublicStore(storeSlug),
    prisma.shippingLane.findMany({
      where: { isActive: true, checkoutEnabled: true, financeApproved: true, complianceApproved: true, operationsApproved: true, originCountry: { isoCode: "BD", isActive: true }, destinationCountry: { isActive: true } },
      select: { id: true, transitDaysMin: true, transitDaysMax: true, destinationCountry: { select: { isoCode: true, name: true, paymentMethods: { where: { checkoutEnabled: true, financeApproved: true, complianceApproved: true, refundsApproved: true, reconciliationApproved: true, paymentMethod: { is: { isActive: true } } }, select: { customerCurrency: true, paymentMethod: { select: { adapterCode: true } } } } } } },
      orderBy: { destinationCountry: { name: "asc" } },
    }),
  ]);
  if (!store) notFound();
  const filters = storeCatalogFilters(filtersParams);
  const sort: CatalogSortValue = ["price_asc", "price_desc", "name_asc"].includes(filters.sort ?? "") ? filters.sort as CatalogSortValue : "recommended";
  const products = filteredStoreProducts(store.products, filters);
  if (sort !== "recommended") products.sort((left, right) => {
    if (sort === "name_asc") return left.titleEn.localeCompare(right.titleEn) || left.id.localeCompare(right.id);
    const leftPrice = left.variants[0]?.priceBdt; const rightPrice = right.variants[0]?.priceBdt;
    if (leftPrice == null) return rightPrice == null ? left.id.localeCompare(right.id) : 1;
    if (rightPrice == null) return -1;
    return (Number(leftPrice) - Number(rightPrice)) * (sort === "price_asc" ? 1 : -1) || left.id.localeCompare(right.id);
  });
  const money = await getMarketMoneyContext(await serverMarketCountry(session), session?.roles.includes("customer_business") ? "BUSINESS" : "PERSONAL");
  const readyLanes = (await Promise.all(lanes.map(async (lane) => await hasRuntimeReadyPaymentOption(prisma, lane.destinationCountry.paymentMethods) ? lane : null))).filter((lane): lane is NonNullable<typeof lane> => Boolean(lane));
  return <main className="public-catalog marketplace-stores">
    <StoreHeader session={session} />
    <section className="public-store-banner"><Link href="/stores">← All Bangladesh stores</Link><div className="public-store-identity"><div className="store-avatar large" aria-hidden="true">{store.businessName.slice(0, 1).toUpperCase()}</div><div><span className="verified-store">✓ Verified Bangladesh seller · {store.storeCode}</span><h1>{store.businessName}</h1><p>{store.storeDescription ?? "Approved Bangladesh products with local delivery options."}</p></div></div><div className="public-store-facts"><span><b>Origin</b>Bangladesh</span><span><b>Local orders</b>Bangladesh delivery</span><span><b>Preparation</b>About {store.processingDays} day{store.processingDays === 1 ? "" : "s"}</span><span><b>Products</b>{store.products.length} approved</span></div></section>
    <section className="stores-content store-products"><div className="store-delivery-panel"><div><p className="eyebrow">DELIVERY OPTIONS</p><h2>Buy locally or internationally</h2></div><div className="store-delivery-options"><article><b>Bangladesh local delivery</b><span>Choose a Bangladesh address at checkout. No international shipping lane is required.</span></article>{readyLanes.map((lane) => <article key={lane.id}><b>{lane.destinationCountry.name}</b><span>{lane.transitDaysMin && lane.transitDaysMax ? `${lane.transitDaysMin}–${lane.transitDaysMax} estimated transit days` : "International delivery details are confirmed during checkout"}</span></article>)}{!readyLanes.length ? <p>International destinations will appear here after the administrator completes route, payment, and currency readiness.</p> : null}</div></div>
      <div className="catalog-layout store-catalog-layout"><CatalogFilters basePath={`/stores/${store.storeSlug}`} values={filters} /><div className="catalog-results-main"><div className="section-heading"><div><h2>Products from {store.businessName}</h2><p className="section-note">{products.length} approved product{products.length === 1 ? "" : "s"} matching your filters</p></div><div className="catalog-results-actions"><CatalogSort value={sort} />{filters.minPrice || filters.maxPrice || filters.priceBand || filters.availability || filters.origin || filters.delivery || filters.recency ? <Link href={`/stores/${store.storeSlug}`}>Clear filters</Link> : null}</div></div>{products.length ? <div className="public-product-grid">{products.map((product) => { const variant = product.variants[0]; const unavailable = !variant || !variant.priceBdt || variant.stockStatus === "OUT_OF_STOCK" || variant.inventoryQuantity === 0; return <article className="public-product-card" key={product.id}><Link className="public-product-card-main" href={`/products/${product.id}`}><div className="public-product-art" aria-hidden="true">◇</div><div className="public-product-card-copy"><small>{product.category?.nameEn ?? "Bangladesh product"}</small><h3>{product.titleEn}</h3>{product.titleBn ? <p className="product-bn">{product.titleBn}</p> : null}<p>{product.description ? `${product.description.slice(0, 110)}${product.description.length > 110 ? "…" : ""}` : "Open for product details."}</p><div className="public-product-meta"><b>{variant?.priceBdt ? formatMarketMoney(variant.priceBdt, money) : "Request price"}</b><span>{variant?.stockStatus?.replaceAll("_", " ") ?? "Confirm availability"}</span></div></div></Link><div className="public-product-card-actions">{variant ? <AddToCartButton compact disabled={unavailable} productVariantId={variant.id} quantity={Math.min(product.minimumOrderQuantity, 99)} /> : <span>Purchasing options unavailable</span>}</div></article>; })}</div> : <div className="catalog-empty"><h2>No matching products</h2><p>Try removing a filter or explore this store’s full approved catalog.</p><Link className="button secondary" href={`/stores/${store.storeSlug}`}>Reset filters</Link></div>}</div></div>
    </section>
  </main>;
}
