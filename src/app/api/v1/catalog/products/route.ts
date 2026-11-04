import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { MARKET_COUNTRY_COOKIE, requestMarketCountry } from "@/lib/customer-market";
import { convertMarketAmount, getMarketMoneyContext } from "@/lib/market-money";
import { customerMarketLabel } from "@/modules/catalog/market-policy";
import { marketOrderedProductPage } from "@/modules/catalog/market-pagination";

export async function GET(request: NextRequest) {
  const session = await getRequestSession(request);
  const query = request.nextUrl.searchParams.get("q")?.trim();
  const category = request.nextUrl.searchParams.get("category")?.trim().toLowerCase();
  const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") ?? 1) || 1);
  const pageSize = Math.min(48, Math.max(1, Number(request.nextUrl.searchParams.get("pageSize") ?? 24) || 24));
  const requestedCountry = request.nextUrl.searchParams.get("marketCountry");
  if (requestedCountry && !/^[A-Za-z]{2}$/.test(requestedCountry)) return apiError("INVALID_MARKET_COUNTRY", "Market country must be a two-letter ISO code.", 422);
  const marketCountry = await requestMarketCountry(request, session, requestedCountry);
  if (query && query.length > 100) return apiError("INVALID_QUERY", "Search query is too long.", 422);
  const where = { status: "ACTIVE" as const, complianceStatus: "CLEAR" as const, deletedAt: null, category: { is: { isActive: true, ...(category ? { slug: category } : {}) } }, AND: [{ OR: [{ sellerProfileId: null }, { sellerProfile: { status: "APPROVED" as const } }] }, ...(query ? [{ OR: [{ productCode: { equals: query.toUpperCase() } }, { titleEn: { contains: query, mode: "insensitive" as const } }, { titleBn: { contains: query, mode: "insensitive" as const } }, { description: { contains: query, mode: "insensitive" as const } }, { sellerProfile: { is: { businessName: { contains: query, mode: "insensitive" as const }, status: "APPROVED" as const } } }] }] : [])] };
  const ordered = await marketOrderedProductPage(where, marketCountry, page, pageSize);
  const rows = ordered.ids.length ? await prisma.product.findMany({ where: { id: { in: ordered.ids } }, select: { id: true, productCode: true, titleEn: true, titleBn: true, description: true, originCountryCode: true, isInternationallyAvailable: true, category: { select: { id: true, slug: true, nameEn: true, nameBn: true } }, sellerProfile: { select: { businessName: true, storeSlug: true } }, variants: { select: { id: true, priceBdt: true, priceCurrency: true, inventoryQuantity: true, stockStatus: true, weightGrams: true }, take: 1 } } }) : [];
  const rowsById = new Map(rows.map((product) => [product.id, product]));
  const money = await getMarketMoneyContext(marketCountry, session?.identityRoles.includes("customer_business") ? "BUSINESS" : "PERSONAL");
  const products = ordered.ids.flatMap((id) => rowsById.get(id) ?? []).map((product) => ({ ...product, variants: product.variants.map((variant) => ({ ...variant, displayPrice: convertMarketAmount(variant.priceBdt, money), displayCurrency: money.currency })) }));
  const cookiePersonalized = request.cookies.has(MARKET_COUNTRY_COOKIE);
  return apiSuccess({ products, meta: { page, pageSize, total: ordered.total, hasNextPage: page * pageSize < ordered.total, marketCountry, rankingPolicy: customerMarketLabel(marketCountry) } }, { headers: { "Cache-Control": session || cookiePersonalized ? "private, no-store, max-age=0" : "public, s-maxage=60, stale-while-revalidate=300" } });
}
