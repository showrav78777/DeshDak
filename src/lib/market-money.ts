import { Prisma, type CustomerAccountType } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type MarketMoneyContext = { currency: "BDT" | "USD"; effectiveRate: string | null; rateAvailable: boolean };

export async function getMarketMoneyContext(countryCode: string, customerSegment: CustomerAccountType = "PERSONAL"): Promise<MarketMoneyContext> {
  if (countryCode.trim().toUpperCase() === "BD") return { currency: "BDT", effectiveRate: "1", rateAvailable: true };
  const now = new Date();
  const rate = await prisma.exchangeRate.findFirst({
    where: { baseCurrency: "BDT", quoteCurrency: "USD", customerSegment, status: "ACTIVE", financeApproved: true, complianceApproved: true, validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gt: now } }] },
    select: { marketRate: true, spreadPercent: true },
    orderBy: [{ validFrom: "desc" }, { activatedAt: "desc" }],
  });
  if (!rate) return { currency: "USD", effectiveRate: null, rateAvailable: false };
  return { currency: "USD", effectiveRate: rate.marketRate.mul(new Prisma.Decimal(1).plus(rate.spreadPercent.div(100))).toString(), rateAvailable: true };
}

export function convertMarketAmount(amountBdt: Prisma.Decimal | number | string | null | undefined, context: MarketMoneyContext) {
  if (amountBdt === null || amountBdt === undefined || !context.rateAvailable || !context.effectiveRate) return null;
  return new Prisma.Decimal(amountBdt).mul(context.effectiveRate).toDecimalPlaces(2).toFixed(2);
}

export function formatMarketMoney(amountBdt: Prisma.Decimal | number | string | null | undefined, context: MarketMoneyContext) {
  const amount = convertMarketAmount(amountBdt, context);
  if (amount === null) return context.currency === "USD" ? "USD rate unavailable" : "Request price";
  const formatted = Number(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return context.currency === "BDT" ? `৳${formatted}` : `$${formatted}`;
}
