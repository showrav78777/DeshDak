import { Prisma, type CustomerAccountType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { FxRateUnavailableError, quoteFx, type FxQuote } from "@/modules/fx/service";
import { isPaymentProviderConfigured } from "@/modules/payments/registry";

type PaymentClient = Pick<Prisma.TransactionClient, "paymentMethod" | "exchangeRate" | "fxSnapshot">;
type ResolvedMethod = { id: string; code: string; displayName: string; kind: string; adapterCode: string; minimumAmount: Prisma.Decimal | null; maximumAmount: Prisma.Decimal | null; quote: FxQuote; isDefaultCurrency: boolean };

async function resolveRecords(client: PaymentClient, input: { countryCode: string; baseCurrency: string; amount: Prisma.Decimal | number | string; customerSegment: CustomerAccountType; providerCode?: string }) {
  const methods = await client.paymentMethod.findMany({
    where: { ...(input.providerCode ? { code: input.providerCode.toUpperCase() } : {}), isActive: true, countryAvailability: { some: { checkoutEnabled: true, financeApproved: true, complianceApproved: true, refundsApproved: true, reconciliationApproved: true, country: { is: { isoCode: input.countryCode.toUpperCase(), isActive: true } } } } },
    select: { id: true, code: true, displayName: true, kind: true, adapterCode: true, countryAvailability: { where: { checkoutEnabled: true, financeApproved: true, complianceApproved: true, refundsApproved: true, reconciliationApproved: true, country: { is: { isoCode: input.countryCode.toUpperCase(), isActive: true } } }, select: { customerCurrency: true, minimumAmount: true, maximumAmount: true, country: { select: { defaultCurrency: true } } } } },
    orderBy: { displayName: "asc" },
  });
  const amount = new Prisma.Decimal(input.amount);
  const candidates = methods.flatMap((method) => method.countryAvailability.map(async (availability): Promise<ResolvedMethod | null> => {
    if (!isPaymentProviderConfigured(method.adapterCode)) return null;
    try {
      const quote = await quoteFx(client, { baseCurrency: input.baseCurrency, quoteCurrency: availability.customerCurrency, amount, customerSegment: input.customerSegment });
      if (availability.minimumAmount && quote.convertedAmount.lt(availability.minimumAmount)) return null;
      if (availability.maximumAmount && quote.convertedAmount.gt(availability.maximumAmount)) return null;
      return { id: method.id, code: method.code, displayName: method.displayName, kind: method.kind, adapterCode: method.adapterCode, minimumAmount: availability.minimumAmount, maximumAmount: availability.maximumAmount, quote, isDefaultCurrency: availability.country.defaultCurrency === availability.customerCurrency };
    } catch (error) {
      if (error instanceof FxRateUnavailableError) return null;
      throw error;
    }
  }));
  return (await Promise.all(candidates)).filter((record): record is ResolvedMethod => Boolean(record)).sort((left, right) => Number(right.isDefaultCurrency) - Number(left.isDefaultCurrency));
}

export async function getAvailablePaymentMethods(countryCode: string, baseCurrency: string, amount: Prisma.Decimal | number | string, customerSegment: CustomerAccountType = "PERSONAL") {
  const records = await resolveRecords(prisma, { countryCode, baseCurrency, amount, customerSegment });
  return records.map((record) => ({ id: record.id, code: record.code, displayName: record.displayName, kind: record.kind, currency: record.quote.quoteCurrency, payableAmount: record.quote.convertedAmount.toFixed(2), minimumAmount: record.minimumAmount?.toString() ?? null, maximumAmount: record.maximumAmount?.toString() ?? null, validUntil: record.quote.validUntil?.toISOString() ?? null }));
}

export async function resolvePaymentMethod(client: PaymentClient, input: { providerCode: string; countryCode: string; baseCurrency: string; amount: Prisma.Decimal | number | string; customerSegment: CustomerAccountType }) {
  const records = await resolveRecords(client, { ...input, providerCode: input.providerCode });
  return records[0] ?? null;
}

export async function hasRuntimeReadyPaymentOption(client: Pick<Prisma.TransactionClient, "exchangeRate">, methods: Array<{ customerCurrency: string; paymentMethod: { adapterCode: string } }>, baseCurrency = "BDT") {
  const base = baseCurrency.toUpperCase();
  const currencies = [...new Set(methods.filter((method) => isPaymentProviderConfigured(method.paymentMethod.adapterCode)).map((method) => method.customerCurrency.toUpperCase()))];
  if (currencies.includes(base)) return true;
  if (!currencies.length) return false;
  const now = new Date();
  const rates = await client.exchangeRate.findMany({ where: { baseCurrency: base, quoteCurrency: { in: currencies }, status: "ACTIVE", financeApproved: true, complianceApproved: true, validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gt: now } }] }, select: { quoteCurrency: true, customerSegment: true } });
  return currencies.some((currency) => rates.some((rate) => rate.quoteCurrency === currency && rate.customerSegment === "PERSONAL") && rates.some((rate) => rate.quoteCurrency === currency && rate.customerSegment === "BUSINESS"));
}
