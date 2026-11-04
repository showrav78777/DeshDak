import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import type { Prisma } from "@prisma/client";
import { cache } from "react";
import { StoreHeader } from "@/components/store-header";
import { ActivityBeacon } from "@/components/activity-beacon";
import { AddToCartButton } from "@/components/add-to-cart-button";
import { CatalogSort, type CatalogSortValue } from "@/components/catalog-sort";
import { CatalogFilters, type CatalogFilterValues } from "@/components/catalog-filters";
import { prisma } from "@/lib/prisma";
import { serverMarketCountry } from "@/lib/customer-market";
import { formatMarketMoney, getMarketMoneyContext } from "@/lib/market-money";
import { getServerSession } from "@/lib/server-session";
import { searchApprovedCatalog } from "@/modules/ai/catalog-search";
import { customerMarketLabel } from "@/modules/catalog/market-policy";
import { marketOrderedProductPage } from "@/modules/catalog/market-pagination";
import { sortedProductPage } from "@/modules/catalog/sorted-pagination";
import { publicMediaUrl } from "@/modules/reels/media";

export const dynamic = "force-dynamic";

const getPublicCategory = cache(async (slug: string) => prisma.category.findFirst({
  where: { slug, isActive: true },
  select: { id: true, slug: true, nameEn: true, nameBn: true, description: true },
}));

function sortCatalogProducts<T extends { titleEn: string; variants: { priceBdt: unknown }[] }>(items: T[], sort: CatalogSortValue) {
  if (sort === "recommended") return items;
  return [...items].sort((left, right) => {
    if (sort === "name_asc") return left.titleEn.localeCompare(right.titleEn);
    const missing = sort === "price_asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    const leftPrice = Number(left.variants[0]?.priceBdt ?? missing);
    const rightPrice = Number(right.variants[0]?.priceBdt ?? missing);
    return sort === "price_asc" ? leftPrice - rightPrice : rightPrice - leftPrice;
  });
}

function boundedNumber(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed, 10_000_000) : undefined;
}

function priceRange(priceBand: string | undefined) {
  const bands: Record<string, [number, number | undefined]> = { "0-999": [0, 999], "1000-2499": [1000, 2499], "2500-4999": [2500, 4999], "5000-9999": [5000, 9999], "10000-plus": [10000, undefined] };
  return priceBand ? bands[priceBand] : undefined;
}

function catalogFilters(params: Record<string, string | string[] | undefined>): CatalogFilterValues {
  const value = (key: string) => typeof params[key] === "string" ? params[key] as string : undefined;
  return { q: value("q"), category: value("category"), sort: value("sort"), minPrice: value("minPrice"), maxPrice: value("maxPrice"), priceBand: priceRange(value("priceBand")) ? value("priceBand") : undefined, availability: ["ready", "stock"].includes(value("availability") ?? "") ? value("availability") : undefined, origin: ["BD", "GLOBAL"].includes(value("origin") ?? "") ? value("origin") : undefined, delivery: value("delivery") === "international" ? "international" : undefined, recency: ["7", "30"].includes(value("recency") ?? "") ? value("recency") : undefined };
}

function catalogVariantFilters(filters: CatalogFilterValues): Prisma.ProductVariantWhereInput {
  const [bandMin, bandMax] = priceRange(filters.priceBand) ?? [];
  const minPrice = boundedNumber(filters.minPrice) ?? bandMin;
  const maxPrice = boundedNumber(filters.maxPrice) ?? bandMax;
  const variantWhere: Prisma.ProductVariantWhereInput = {};
  if (minPrice !== undefined || maxPrice !== undefined) variantWhere.priceBdt = { ...(minPrice !== undefined ? { gte: minPrice } : {}), ...(maxPrice !== undefined ? { lte: maxPrice } : {}) };
  if (filters.availability === "ready") variantWhere.inventoryQuantity = { gt: 0 };
  if (filters.availability === "stock") variantWhere.stockStatus = "IN_STOCK";
  return variantWhere;
}

function catalogWhereFilters(filters: CatalogFilterValues): Prisma.ProductWhereInput {
  const variantWhere = catalogVariantFilters(filters);
  const recencyDays = filters.recency ? Number(filters.recency) : undefined;
  return {
    ...(filters.origin === "BD" ? { originCountryCode: "BD" } : filters.origin === "GLOBAL" ? { originCountryCode: { not: "BD" } } : {}),
    ...(filters.delivery === "international" ? { isInternationallyAvailable: true } : {}),
    ...(recencyDays ? { createdAt: { gte: new Date(Date.now() - recencyDays * 86_400_000) } } : {}),
    ...(Object.keys(variantWhere).length ? { variants: { some: variantWhere } } : {}),
  };
}

function matchesCatalogFilters(product: { originCountryCode: string; isInternationallyAvailable: boolean; createdAt: Date; variants: { priceBdt: unknown; inventoryQuantity: number | null; stockStatus: string | null }[] }, filters: CatalogFilterValues) {
  const [bandMin, bandMax] = priceRange(filters.priceBand) ?? [];
  const minPrice = boundedNumber(filters.minPrice) ?? bandMin;
  const maxPrice = boundedNumber(filters.maxPrice) ?? bandMax;
  const variant = product.variants[0];
  const price = Number(variant?.priceBdt ?? NaN);
  if (minPrice !== undefined && price < minPrice) return false;
  if (maxPrice !== undefined && price > maxPrice) return false;
  if (filters.availability === "ready" && (!variant || (variant.inventoryQuantity ?? 0) <= 0)) return false;
  if (filters.availability === "stock" && variant?.stockStatus !== "IN_STOCK") return false;
  if (filters.origin === "BD" && product.originCountryCode !== "BD") return false;
  if (filters.origin === "GLOBAL" && product.originCountryCode === "BD") return false;
  if (filters.delivery === "international" && !product.isInternationallyAvailable) return false;
  return !filters.recency || product.createdAt >= new Date(Date.now() - Number(filters.recency) * 86_400_000);
}

export async function generateMetadata({ searchParams }: PageProps<"/products">): Promise<Metadata> {
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim().slice(0, 200) : "";
  const categorySlug = typeof params.category === "string" ? params.category.trim().toLowerCase().slice(0, 80) : "";
  const page = Math.max(1, Number(typeof params.page === "string" ? params.page : 1) || 1);
  const category = categorySlug ? await getPublicCategory(categorySlug) : null;
  if (query || (categorySlug && !category)) {
    return {
      title: query ? `Search results for ${query}` : "Category unavailable",
      description: "Search DeshDak's approved public product catalog.",
      alternates: { canonical: "/products" },
      robots: { index: false, follow: true },
    };
  }
  const canonical = category
    ? `/products?category=${encodeURIComponent(category.slug)}${page > 1 ? `&page=${page}` : ""}`
    : page > 1 ? `/products?page=${page}` : "/products";
  const title = category ? `${category.nameEn} products` : "Browse products";
  const description = category?.description?.trim().slice(0, 160)
    || (category ? `Browse approved ${category.nameEn} products from DeshDak's public marketplace.` : "Search DeshDak's approved public product catalog by product name, category, store, or description before signing in.");
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title: category ? `${category.nameEn} products on DeshDak` : "Browse approved products on DeshDak", description, url: canonical },
  };
}

export default async function PublicProductsPage({ searchParams }: PageProps<"/products">) {
  const [params, session] = await Promise.all([searchParams, getServerSession()]);
  const marketCountry = await serverMarketCountry(session);
  const money = await getMarketMoneyContext(marketCountry, session?.roles.includes("customer_business") ? "BUSINESS" : "PERSONAL");
  const query = typeof params.q === "string" ? params.q.trim().slice(0, 200) : "";
  const categorySlug = typeof params.category === "string" ? params.category.trim().toLowerCase().slice(0, 80) : "";
  const page = Math.max(1, Number(typeof params.page === "string" ? params.page : 1) || 1);
  const sort: CatalogSortValue = typeof params.sort === "string" && ["price_asc", "price_desc", "name_asc"].includes(params.sort) ? params.sort as CatalogSortValue : "recommended";
  const filters = catalogFilters(params);
  const pageSize = 24;
  const selectedCategory = categorySlug ? await getPublicCategory(categorySlug) : null;
  let products;
  let total;
  if (query) {
    const ranked = await searchApprovedCatalog(query, 500, marketCountry);
    const filtered = (selectedCategory ? ranked.filter((product) => product.category?.id === selectedCategory.id) : ranked).filter((product) => matchesCatalogFilters(product, filters));
    total = filtered.length;
    products = sortCatalogProducts(filtered, sort).slice((page - 1) * pageSize, page * pageSize);
  } else {
    const where: Prisma.ProductWhereInput = { status: "ACTIVE", complianceStatus: "CLEAR", deletedAt: null, category: { is: { isActive: true, ...(selectedCategory ? { id: selectedCategory.id } : {}) } }, ...catalogWhereFilters(filters) };
    const ordered = sort === "recommended"
      ? await marketOrderedProductPage(where, marketCountry, page, pageSize)
      : await sortedProductPage(where, catalogVariantFilters(filters), sort, page, pageSize);
    const rows = ordered.ids.length ? await prisma.product.findMany({ where: { id: { in: ordered.ids } }, select: { id: true, titleEn: true, titleBn: true, description: true, originCountryCode: true, isInternationallyAvailable: true, minimumOrderQuantity: true, category: { select: { id: true, slug: true, nameEn: true, nameBn: true } }, sellerProfile: { select: { businessName: true, storeSlug: true } }, media: { where: { status: "READY", kind: "IMAGE" }, select: { storageKey: true, altText: true }, take: 1 }, variants: { where: catalogVariantFilters(filters), orderBy: { priceBdt: "asc" }, select: { id: true, priceBdt: true, priceCurrency: true, inventoryQuantity: true, stockStatus: true }, take: 1 } } }) : [];
    const rowsById = new Map(rows.map((product) => [product.id, product]));
    products = ordered.ids.flatMap((id) => rowsById.get(id) ?? []);
    total = ordered.total;
  }
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const filterQuery = new URLSearchParams(Object.fromEntries(Object.entries({ ...filters, ...(sort !== "recommended" ? { sort } : {}) }).filter(([, value]) => Boolean(value))));
  return <main className="public-catalog">
    {session && query ? <ActivityBeacon eventType="CATALOG_SEARCH" path="/products" resultCount={total} /> : session && selectedCategory ? <ActivityBeacon eventType="CATEGORY_VIEW" objectId={selectedCategory.id} path="/products" resultCount={total} /> : null}
    <StoreHeader session={session} />
    <section className="catalog-search-band catalog-intro-band"><div><p className="eyebrow">PUBLIC PRODUCT CATALOG</p><h1>{selectedCategory ? selectedCategory.nameEn : query ? `Results for “${query}”` : "Browse before you sign in."}</h1>{selectedCategory?.nameBn ? <p>{selectedCategory.nameBn}</p> : <p>Discover verified marketplace products. Refine results below or use text, image, and AI search in the header.</p>}</div></section>
    <section className="catalog-results"><div className="catalog-layout"><CatalogFilters values={filters} /><div className="catalog-results-main"><div className="section-heading"><div><h2>{query ? `Results for “${query}”` : selectedCategory ? `${selectedCategory.nameEn} products` : "Available products"}</h2><p className="section-note">{total} approved product{total === 1 ? "" : "s"} · {sort === "recommended" ? customerMarketLabel(marketCountry) === "GLOBAL_FIRST" ? "Global products prioritized for Bangladesh" : `Products from ${marketCountry} prioritized, then global products` : sort === "price_asc" ? "Sorted by price: low to high" : sort === "price_desc" ? "Sorted by price: high to low" : "Sorted by name: A to Z"}</p></div><div className="catalog-results-actions"><CatalogSort value={sort} />{query || selectedCategory || filters.minPrice || filters.maxPrice || filters.priceBand || filters.availability || filters.origin || filters.delivery || filters.recency ? <Link href="/products">Clear filters</Link> : null}</div></div>
      {categorySlug && !selectedCategory ? <div className="catalog-empty"><span>!</span><h2>Category is not available</h2><p>This category may be inactive or no longer public.</p></div> : products.length ? <div className="public-product-grid">{products.map((product) => { const variant = product.variants[0]; const primaryMedia = product.media[0]; const primaryImageUrl = primaryMedia ? publicMediaUrl(primaryMedia.storageKey) : null; const unavailable = !variant || !variant.priceBdt || variant.stockStatus === "OUT_OF_STOCK" || variant.inventoryQuantity === 0; return <article className="public-product-card" key={product.id}><Link className="public-product-card-main" href={`/products/${product.id}`}><div className="public-product-art">{primaryImageUrl ? <Image alt={primaryMedia?.altText ?? product.titleEn} height={520} src={primaryImageUrl} unoptimized width={520} /> : <span aria-hidden="true">◇</span>}<small>{product.originCountryCode === "BD" ? "Bangladesh store" : "Global sourcing"}</small></div><div className="public-product-card-copy"><small>{product.sellerProfile?.businessName ?? product.category?.nameEn ?? "Cross-border catalog"}{product.originCountryCode === "BD" ? " · Bangladesh" : ""}</small><h3>{product.titleEn}</h3>{product.titleBn ? <p className="product-bn">{product.titleBn}</p> : null}<p>{product.description ? `${product.description.slice(0, 110)}${product.description.length > 110 ? "…" : ""}` : "Open for product details and available variants."}</p><div className="public-product-meta"><b>{variant?.priceBdt ? formatMarketMoney(variant.priceBdt, money) : "Request price"}</b><span>{variant?.stockStatus?.replaceAll("_", " ") ?? "Availability on request"}</span></div>{product.isInternationallyAvailable ? <em className="international-product-label">International delivery</em> : null}</div></Link><div className="public-product-card-actions">{variant ? <AddToCartButton compact disabled={unavailable} productVariantId={variant.id} quantity={Math.min(product.minimumOrderQuantity, 99)} /> : <span>Purchasing options unavailable</span>}</div></article>; })}</div> : <div className="catalog-empty"><span>⌕</span><h2>No approved products found</h2><p>Try fewer words or another product name. Search checks titles, Bengali titles, categories, stores, and descriptions.</p><Link className="button secondary" href="/products">Reset search and filters</Link></div>}
      {pages > 1 ? <nav className="catalog-pagination" aria-label="Catalog pages">{page > 1 ? <Link href={`/products?${filterQuery.toString()}&page=${page - 1}`}>← Previous</Link> : <span />}<b>Page {page} of {pages}</b>{page < pages ? <Link href={`/products?${filterQuery.toString()}&page=${page + 1}`}>Next →</Link> : <span />}</nav> : null}</div></div>
    </section>
  </main>;
}
