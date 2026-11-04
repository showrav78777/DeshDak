import { Prisma, type CustomerAccountType } from "@prisma/client";

type FxClient = Pick<Prisma.TransactionClient, "exchangeRate" | "fxSnapshot">;

export class FxRateUnavailableError extends Error {
  constructor(public readonly baseCurrency: string, public readonly quoteCurrency: string) {
    super(`No approved exchange rate is available for ${baseCurrency}/${quoteCurrency}.`);
    this.name = "FxRateUnavailableError";
  }
}

export type FxQuote = {
  exchangeRateId: string | null;
  pair: string;
  baseCurrency: string;
  quoteCurrency: string;
  baseAmount: Prisma.Decimal;
  convertedAmount: Prisma.Decimal;
  customerSegment: CustomerAccountType;
  effectiveRate: Prisma.Decimal;
  spreadPercent: Prisma.Decimal;
  source: string;
  validUntil: Date | null;
};

function currencyCode(value: string) {
  return value.trim().toUpperCase();
}

export async function quoteFx(
  client: FxClient,
  input: { baseCurrency: string; quoteCurrency: string; amount: Prisma.Decimal | number | string; customerSegment: CustomerAccountType; at?: Date },
): Promise<FxQuote> {
  const baseCurrency = currencyCode(input.baseCurrency);
  const quoteCurrency = currencyCode(input.quoteCurrency);
  const baseAmount = new Prisma.Decimal(input.amount);
  if (!baseAmount.isPositive()) throw new Error("FX amount must be positive.");
  if (baseCurrency === quoteCurrency) {
    return { exchangeRateId: null, pair: `${baseCurrency}_${quoteCurrency}`, baseCurrency, quoteCurrency, baseAmount, convertedAmount: baseAmount.toDecimalPlaces(2), customerSegment: input.customerSegment, effectiveRate: new Prisma.Decimal(1), spreadPercent: new Prisma.Decimal(0), source: "CURRENCY_PARITY", validUntil: null };
  }

  const at = input.at ?? new Date();
  const rate = await client.exchangeRate.findFirst({
    where: {
      baseCurrency,
      quoteCurrency,
      customerSegment: input.customerSegment,
      status: "ACTIVE",
      financeApproved: true,
      complianceApproved: true,
      validFrom: { lte: at },
      OR: [{ validTo: null }, { validTo: { gt: at } }],
    },
    orderBy: [{ validFrom: "desc" }, { activatedAt: "desc" }],
  });
  if (!rate) throw new FxRateUnavailableError(baseCurrency, quoteCurrency);
  const effectiveRate = rate.marketRate.mul(new Prisma.Decimal(1).plus(rate.spreadPercent.div(100)));
  return {
    exchangeRateId: rate.id,
    pair: `${baseCurrency}_${quoteCurrency}`,
    baseCurrency,
    quoteCurrency,
    baseAmount,
    convertedAmount: baseAmount.mul(effectiveRate).toDecimalPlaces(2),
    customerSegment: input.customerSegment,
    effectiveRate,
    spreadPercent: rate.spreadPercent,
    source: `${rate.source}:${rate.id}`,
    validUntil: rate.validTo,
  };
}

export async function createFxSnapshot(client: FxClient, quote: FxQuote, context: { type: string; id?: string | null }) {
  return client.fxSnapshot.create({
    data: {
      exchangeRateId: quote.exchangeRateId,
      pair: quote.pair,
      baseCurrency: quote.baseCurrency,
      quoteCurrency: quote.quoteCurrency,
      baseAmount: quote.baseAmount,
      convertedAmount: quote.convertedAmount,
      customerSegment: quote.customerSegment,
      rateUsed: quote.effectiveRate,
      spreadApplied: quote.spreadPercent,
      source: quote.source,
      contextType: context.type,
      contextId: context.id ?? null,
    },
  });
}

export function isRateCurrentlyUsable(rate: { status: string; financeApproved: boolean; complianceApproved: boolean; validFrom: Date; validTo: Date | null }, at = new Date()) {
  return rate.status === "ACTIVE" && rate.financeApproved && rate.complianceApproved && rate.validFrom <= at && (!rate.validTo || rate.validTo > at);
}

export async function hasRequiredFxCoverage(client: Pick<Prisma.TransactionClient, "exchangeRate">, baseCurrency: string, quoteCurrency: string, at = new Date()) {
  const base = currencyCode(baseCurrency); const quote = currencyCode(quoteCurrency);
  if (base === quote) return true;
  const rates = await client.exchangeRate.findMany({ where: { baseCurrency: base, quoteCurrency: quote, status: "ACTIVE", financeApproved: true, complianceApproved: true, validFrom: { lte: at }, OR: [{ validTo: null }, { validTo: { gt: at } }] }, distinct: ["customerSegment"], select: { customerSegment: true } });
  return rates.some((rate) => rate.customerSegment === "PERSONAL") && rates.some((rate) => rate.customerSegment === "BUSINESS");
}
