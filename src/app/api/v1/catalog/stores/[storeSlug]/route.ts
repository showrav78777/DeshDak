import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { MARKET_COUNTRY_COOKIE, requestMarketCountry } from "@/lib/customer-market";
import { convertMarketAmount, getMarketMoneyContext } from "@/lib/market-money";
import { getRequestSession } from "@/lib/request-session";

export async function GET(request: NextRequest, context: RouteContext<"/api/v1/catalog/stores/[storeSlug]">) {
  const { storeSlug } = await context.params;
  const store = await prisma.sellerProfile.findFirst({
    where: { storeSlug, status: "APPROVED", shipsInternationally: true },
    select: {
      id: true,
      storeCode: true,
      businessName: true,
      storeSlug: true,
      storeDescription: true,
      originCountryCode: true,
      processingDays: true,
      products: {
        where: { status: "ACTIVE", complianceStatus: "CLEAR", deletedAt: null, isInternationallyAvailable: true, category: { is: { isActive: true } } },
        select: { id: true, productCode: true, titleEn: true, titleBn: true, description: true, originCountryCode: true, category: { select: { id: true, slug: true, nameEn: true, nameBn: true } }, variants: { select: { id: true, priceBdt: true, priceCurrency: true, inventoryQuantity: true, stockStatus: true, weightGrams: true }, orderBy: { createdAt: "asc" } } },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!store) return apiError("STORE_NOT_FOUND", "Public store not found.", 404);
  const session = await getRequestSession(request);
  const marketCountry = await requestMarketCountry(request, session, request.nextUrl.searchParams.get("marketCountry"));
  const money = await getMarketMoneyContext(marketCountry, session?.identityRoles.includes("customer_business") ? "BUSINESS" : "PERSONAL");
  const publicStore = { ...store, products: store.products.map((product) => ({ ...product, variants: product.variants.map((variant) => ({ ...variant, displayPrice: convertMarketAmount(variant.priceBdt, money), displayCurrency: money.currency })) })) };
  return apiSuccess({ store: publicStore, marketCountry }, { headers: { "Cache-Control": session || request.cookies.has(MARKET_COUNTRY_COOKIE) ? "private, no-store, max-age=0" : "public, s-maxage=60, stale-while-revalidate=300" } });
}
