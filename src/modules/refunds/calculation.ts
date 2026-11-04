import { Prisma } from "@prisma/client";

export const REFUND_CALCULATION_VERSION = "PROMO_NET_LOCKED_FX_V1";

type Money = Prisma.Decimal | number | string;
type PriorRefund = {
  requestedBaseAmount: Money;
  promotionNettingBaseAmount: Money;
  netBaseAmount: Money;
  settlementAmount: Money;
};

export type RefundCalculationInput = {
  grossOrderBaseAmount: Money;
  promotionDiscountBaseAmount: Money;
  paidBaseAmount: Money;
  paidSettlementAmount: Money;
  requestedGrossBaseAmount: Money;
  priorRefunds: PriorRefund[];
};

export class RefundCalculationError extends Error {
  readonly code: "INVALID_REFUND_BASIS" | "REFUND_AMOUNT_TOO_HIGH" | "NOTHING_LEFT_TO_REFUND";

  constructor(code: "INVALID_REFUND_BASIS" | "REFUND_AMOUNT_TOO_HIGH" | "NOTHING_LEFT_TO_REFUND") {
    super(code);
    this.code = code;
    this.name = "RefundCalculationError";
  }
}

function money(value: Money) {
  return new Prisma.Decimal(value).toDecimalPlaces(2);
}

export function calculateRefund(input: RefundCalculationInput) {
  const grossOrder = money(input.grossOrderBaseAmount);
  const promotionDiscount = money(input.promotionDiscountBaseAmount);
  const paidBase = money(input.paidBaseAmount);
  const paidSettlement = money(input.paidSettlementAmount);
  const requestedGross = money(input.requestedGrossBaseAmount);

  if (!grossOrder.isPositive() || promotionDiscount.isNegative() || !paidBase.isPositive() || !paidSettlement.isPositive() || !requestedGross.isPositive() || !grossOrder.minus(promotionDiscount).equals(paidBase)) throw new RefundCalculationError("INVALID_REFUND_BASIS");

  const prior = input.priorRefunds.reduce((totals, refund) => ({
    gross: totals.gross.plus(money(refund.requestedBaseAmount)),
    promotion: totals.promotion.plus(money(refund.promotionNettingBaseAmount)),
    net: totals.net.plus(money(refund.netBaseAmount)),
    settlement: totals.settlement.plus(money(refund.settlementAmount)),
  }), { gross: new Prisma.Decimal(0), promotion: new Prisma.Decimal(0), net: new Prisma.Decimal(0), settlement: new Prisma.Decimal(0) });

  const remainingGross = grossOrder.minus(prior.gross);
  const remainingSettlement = paidSettlement.minus(prior.settlement);
  if (!remainingGross.isPositive() || !remainingSettlement.isPositive()) throw new RefundCalculationError("NOTHING_LEFT_TO_REFUND");
  if (requestedGross.gt(remainingGross)) throw new RefundCalculationError("REFUND_AMOUNT_TOO_HIGH");

  const cumulativeGross = prior.gross.plus(requestedGross);
  const cumulativePromotion = cumulativeGross.equals(grossOrder)
    ? promotionDiscount
    : promotionDiscount.mul(cumulativeGross).div(grossOrder).toDecimalPlaces(2);
  const promotionNetting = Prisma.Decimal.max(0, cumulativePromotion.minus(prior.promotion)).toDecimalPlaces(2);
  const netBase = requestedGross.minus(promotionNetting).toDecimalPlaces(2);
  if (!netBase.isPositive()) throw new RefundCalculationError("INVALID_REFUND_BASIS");

  const settlementAmount = cumulativeGross.equals(grossOrder)
    ? remainingSettlement
    : paidSettlement.mul(netBase).div(paidBase).toDecimalPlaces(2);
  if (!settlementAmount.isPositive() || settlementAmount.gt(remainingSettlement)) throw new RefundCalculationError("INVALID_REFUND_BASIS");

  return {
    version: REFUND_CALCULATION_VERSION,
    requestedGrossBaseAmount: requestedGross,
    promotionNettingBaseAmount: promotionNetting,
    netBaseAmount: netBase,
    settlementAmount,
    remainingGrossBaseAmount: remainingGross.minus(requestedGross).toDecimalPlaces(2),
    remainingSettlementAmount: remainingSettlement.minus(settlementAmount).toDecimalPlaces(2),
    cumulativeNetBaseAmount: prior.net.plus(netBase).toDecimalPlaces(2),
  };
}
