import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { findAvailableMarketCountry, MARKET_COUNTRY_COOKIE, MARKET_COUNTRY_MAX_AGE_SECONDS } from "@/lib/customer-market";

const schema = z.object({ countryCode: z.string().trim().transform((value) => value.toUpperCase()).pipe(z.string().regex(/^[A-Z]{2}$/)) }).strict();

export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Choose a valid shopping market.", 422);
  const country = await findAvailableMarketCountry(parsed.data.countryCode);
  if (!country) return apiError("MARKET_NOT_AVAILABLE", "That shopping market is not currently enabled.", 409);
  const response = apiSuccess({ market: country }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  response.cookies.set({
    name: MARKET_COUNTRY_COOKIE,
    value: country.isoCode,
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MARKET_COUNTRY_MAX_AGE_SECONDS,
  });
  return response;
}
