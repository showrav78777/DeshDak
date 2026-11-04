import { calculateRefund, RefundCalculationError, REFUND_CALCULATION_VERSION } from "../src/modules/refunds/calculation.ts";
import { canTransitionOrder } from "../src/modules/orders/state-machine.ts";

function assert(condition, message) { if (!condition) throw new Error(message); }
function equals(value, expected, message) { assert(value.toFixed(2) === expected, `${message}: expected ${expected}, received ${value.toFixed(2)}`); }

const first = calculateRefund({ grossOrderBaseAmount: 1000, promotionDiscountBaseAmount: 100, paidBaseAmount: 900, paidSettlementAmount: 1125, requestedGrossBaseAmount: 400, priorRefunds: [] });
equals(first.promotionNettingBaseAmount, "40.00", "First partial refund promotion allocation");
equals(first.netBaseAmount, "360.00", "First partial refund net base amount");
equals(first.settlementAmount, "450.00", "First partial refund locked-FX settlement");
assert(first.version === REFUND_CALCULATION_VERSION, "Refund calculation version was not preserved.");

const second = calculateRefund({ grossOrderBaseAmount: 1000, promotionDiscountBaseAmount: 100, paidBaseAmount: 900, paidSettlementAmount: 1125, requestedGrossBaseAmount: 600, priorRefunds: [{ requestedBaseAmount: 400, promotionNettingBaseAmount: 40, netBaseAmount: 360, settlementAmount: 450 }] });
equals(second.promotionNettingBaseAmount, "60.00", "Final partial refund promotion allocation");
equals(second.netBaseAmount, "540.00", "Final partial refund net base amount");
equals(second.settlementAmount, "675.00", "Final partial refund locked-FX settlement");
equals(second.remainingGrossBaseAmount, "0.00", "Final gross remainder");
equals(second.remainingSettlementAmount, "0.00", "Final settlement remainder");

const roundedFirst = calculateRefund({ grossOrderBaseAmount: 100, promotionDiscountBaseAmount: 10, paidBaseAmount: 90, paidSettlementAmount: 90, requestedGrossBaseAmount: 33.33, priorRefunds: [] });
const roundedFinal = calculateRefund({ grossOrderBaseAmount: 100, promotionDiscountBaseAmount: 10, paidBaseAmount: 90, paidSettlementAmount: 90, requestedGrossBaseAmount: 66.67, priorRefunds: [{ requestedBaseAmount: roundedFirst.requestedGrossBaseAmount, promotionNettingBaseAmount: roundedFirst.promotionNettingBaseAmount, netBaseAmount: roundedFirst.netBaseAmount, settlementAmount: roundedFirst.settlementAmount }] });
equals(roundedFirst.promotionNettingBaseAmount.plus(roundedFinal.promotionNettingBaseAmount), "10.00", "Cumulative promotion rounding");
equals(roundedFirst.settlementAmount.plus(roundedFinal.settlementAmount), "90.00", "Cumulative settlement rounding");

try {
  calculateRefund({ grossOrderBaseAmount: 1000, promotionDiscountBaseAmount: 100, paidBaseAmount: 900, paidSettlementAmount: 1125, requestedGrossBaseAmount: 1000.01, priorRefunds: [] });
  throw new Error("Over-refund was accepted.");
} catch (error) {
  assert(error instanceof RefundCalculationError && error.code === "REFUND_AMOUNT_TOO_HIGH", "Over-refund did not fail with the expected rule code.");
}

assert(canTransitionOrder("PAID", "REFUNDED"), "Paid orders cannot enter the refund terminal state.");
assert(!canTransitionOrder("PENDING_PAYMENT", "REFUNDED"), "Unpaid orders can incorrectly enter the refund terminal state.");
assert(!canTransitionOrder("DELIVERED", "IN_TRANSIT"), "Delivered orders can incorrectly return to transit.");

console.log("Financial rule verification passed: locked FX, promo netting, partial rounding, over-refund rejection, and order state guards.");
