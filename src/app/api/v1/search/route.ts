import { AiCapability, AiConfigurationStatus } from "@prisma/client";
import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { getRequestSession } from "@/lib/request-session";
import { MARKET_COUNTRY_COOKIE, requestMarketCountry } from "@/lib/customer-market";
import { convertMarketAmount, getMarketMoneyContext } from "@/lib/market-money";
import { checkPublicAiRateLimit } from "@/modules/ai/public-rate-limit";
import { searchApprovedCatalog } from "@/modules/ai/catalog-search";
import { getAiConfiguration } from "@/modules/ai/configuration";
import { customerMarketLabel } from "@/modules/catalog/market-policy";

const schema = z.object({ q: z.string().trim().min(2).max(200), type: z.enum(["text"]).default("text"), limit: z.coerce.number().int().min(1).max(24).default(12), marketCountry: z.string().trim().regex(/^[A-Za-z]{2}$/).optional() });

export async function GET(request: NextRequest) {
  const configuration = await getAiConfiguration(AiCapability.TEXT_SEARCH);
  if (configuration.status !== AiConfigurationStatus.LIVE) return apiError("SEARCH_TEMPORARILY_DISABLED", "Product search is temporarily unavailable.", 503);
  const rate = await checkPublicAiRateLimit(request, "public-text-search", configuration.anonymousLimit);
  if (!rate.allowed) return apiError("HUMAN_VERIFICATION_REQUIRED", "Too many anonymous searches. Please wait and verify you are human before continuing.", 429, { retryAfterSeconds: rate.retryAfterSeconds });
  const parsed = schema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Enter a search of 2 to 200 characters.", 422);
  const session = await getRequestSession(request);
  const marketCountry = await requestMarketCountry(request, session, parsed.data.marketCountry);
  const money = await getMarketMoneyContext(marketCountry, session?.identityRoles.includes("customer_business") ? "BUSINESS" : "PERSONAL");
  const products = (await searchApprovedCatalog(parsed.data.q, parsed.data.limit, marketCountry)).map((product) => ({ ...product, variants: product.variants.map((variant) => ({ ...variant, displayPrice: convertMarketAmount(variant.priceBdt, money), displayCurrency: money.currency })) }));
  const cookiePersonalized = request.cookies.has(MARKET_COUNTRY_COOKIE);
  return apiSuccess({ query: parsed.data.q, mode: "KEYWORD", products, zeroResults: products.length === 0, marketCountry, rankingPolicy: customerMarketLabel(marketCountry) }, { headers: { "Cache-Control": session || cookiePersonalized ? "private, no-store, max-age=0" : "public, s-maxage=30, stale-while-revalidate=120", "X-RateLimit-Remaining": String(rate.remaining) } });
}
