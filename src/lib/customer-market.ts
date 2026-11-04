import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import type { SessionPayload } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { DEFAULT_CUSTOMER_COUNTRY, normalizeMarketCountry } from "@/modules/catalog/market-policy";

export const MARKET_COUNTRY_COOKIE = process.env.NODE_ENV === "production" ? "__Host-crossly_market_country" : "crossly_market_country";
export const MARKET_COUNTRY_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;

export async function findAvailableMarketCountry(countryCode: string) {
  const normalized = normalizeMarketCountry(countryCode);
  return prisma.country.findFirst({ where: { isoCode: normalized, isActive: true }, select: { isoCode: true, name: true } });
}

export async function requestMarketCountry(request: NextRequest, session: SessionPayload | null, requestedCountry?: string | null) {
  const selected = requestedCountry ?? request.cookies.get(MARKET_COUNTRY_COOKIE)?.value;
  return resolveMarketCountry(selected, session?.residenceCountryCode);
}

export async function serverMarketCountry(session: SessionPayload | null) {
  return resolveMarketCountry((await cookies()).get(MARKET_COUNTRY_COOKIE)?.value, session?.residenceCountryCode);
}

async function resolveMarketCountry(selectedCountry?: string | null, residenceCountry?: string | null) {
  const candidates = [selectedCountry, residenceCountry, DEFAULT_CUSTOMER_COUNTRY]
    .filter((value): value is string => Boolean(value))
    .map(normalizeMarketCountry);
  const uniqueCandidates = [...new Set(candidates)];
  const available = await prisma.country.findMany({
    where: { isActive: true, isoCode: { in: uniqueCandidates } },
    select: { isoCode: true },
  });
  const availableCodes = new Set(available.map(({ isoCode }) => isoCode));
  const matched = uniqueCandidates.find((candidate) => availableCodes.has(candidate));
  if (matched) return matched;
  return (await prisma.country.findFirst({ where: { isActive: true }, select: { isoCode: true }, orderBy: { name: "asc" } }))?.isoCode ?? DEFAULT_CUSTOMER_COUNTRY;
}
