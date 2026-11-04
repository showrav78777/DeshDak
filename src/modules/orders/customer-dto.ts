import type { ShippingQuote } from "@prisma/client";

/** Keep staff identity and idempotency evidence out of customer/mobile responses. */
export function customerShippingQuote(quote: ShippingQuote) {
  return {
    id: quote.id,
    orderId: quote.orderId,
    version: quote.version,
    shippingLaneId: quote.shippingLaneId,
    chargeableWeightGrams: quote.chargeableWeightGrams,
    declaredWeightGrams: quote.declaredWeightGrams,
    discrepancyPercent: quote.discrepancyPercent,
    discrepancyThresholdPercent: quote.discrepancyThresholdPercent,
    ratePerKgBdt: quote.ratePerKgBdt,
    shippingAmountBdt: quote.shippingAmountBdt,
    lastMileRatePerKgBdt: quote.lastMileRatePerKgBdt,
    lastMileDeliveryBdt: quote.lastMileDeliveryBdt,
    handlingFeeBdt: quote.handlingFeeBdt,
    insuranceFeeBdt: quote.insuranceFeeBdt,
    totalBdt: quote.totalBdt,
    status: quote.status,
    note: quote.note,
    expiresAt: quote.expiresAt,
    acceptedAt: quote.acceptedAt,
    rejectedAt: quote.rejectedAt,
    createdAt: quote.createdAt,
    updatedAt: quote.updatedAt,
  };
}
