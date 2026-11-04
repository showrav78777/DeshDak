import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { MARKET_COUNTRY_COOKIE, requestMarketCountry } from "@/lib/customer-market";
import { convertMarketAmount, getMarketMoneyContext } from "@/lib/market-money";
import { getRequestSession } from "@/lib/request-session";

export async function GET(request: NextRequest, context: RouteContext<"/api/v1/catalog/products/[productId]">) {
  const { productId } = await context.params;
  const product = await prisma.product.findFirst({ where: { id: productId, status: "ACTIVE", complianceStatus: "CLEAR", deletedAt: null, category: { is: { isActive: true } }, OR: [{ sellerProfileId: null }, { sellerProfile: { status: "APPROVED" } }] }, select: { id: true, productCode: true, titleEn: true, titleBn: true, shortDescription: true, description: true, highlights: true, brand: true, modelNumber: true, originCountryCode: true, isInternationallyAvailable: true, minimumOrderQuantity: true, sampleAvailable: true, customizationAvailable: true, productionLeadDaysMin: true, productionLeadDaysMax: true, sellingUnit: true, packageContents: true, returnPolicy: true, warrantyInfo: true, completenessScore: true, category: { select: { id: true, slug: true, nameEn: true, nameBn: true } }, sellerProfile: { select: { businessName: true, storeSlug: true, originCountryCode: true, shipsInternationally: true, processingDays: true } }, media: { where: { status: "READY" }, select: { id: true, kind: true, altText: true, caption: true, sortOrder: true, isPrimary: true }, orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }] }, variants: { select: { id: true, sku: true, attributes: true, priceBdt: true, priceCurrency: true, inventoryQuantity: true, stockStatus: true, weightGrams: true, lengthMm: true, widthMm: true, heightMm: true }, orderBy: { createdAt: "asc" } } } });
  if (!product) return apiError("PRODUCT_NOT_FOUND", "Product was not found.", 404);
  const session = await getRequestSession(request);
  const marketCountry = await requestMarketCountry(request, session, request.nextUrl.searchParams.get("marketCountry"));
  const money = await getMarketMoneyContext(marketCountry, session?.identityRoles.includes("customer_business") ? "BUSINESS" : "PERSONAL");
  const publicProduct = { ...product, variants: product.variants.map((variant) => ({ ...variant, displayPrice: convertMarketAmount(variant.priceBdt, money), displayCurrency: money.currency })) };
  return apiSuccess({ product: publicProduct, marketCountry }, { headers: { "Cache-Control": session || request.cookies.has(MARKET_COUNTRY_COOKIE) ? "private, no-store, max-age=0" : "public, s-maxage=60, stale-while-revalidate=300" } });
}
