import { Prisma, type CustomerAccountType } from "@prisma/client";

export class CouponConflict extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

export type CouponApplication = {
  couponId: string;
  code: string;
  name: string;
  discountType: "PERCENTAGE" | "FIXED_AMOUNT";
  discountValue: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  allowsAutomaticStacking: boolean;
  version: number;
};

export function utcDayBounds(now: Date) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

export async function evaluateCoupon(
  tx: Prisma.TransactionClient,
  input: { code: string; customerId: string; accountType: CustomerAccountType; subtotal: Prisma.Decimal; now?: Date },
): Promise<CouponApplication> {
  const now = input.now ?? new Date();
  const coupon = await tx.coupon.findUnique({ where: { code: input.code.trim().toUpperCase() } });
  if (!coupon) throw new CouponConflict("COUPON_NOT_FOUND", "This coupon code is not valid.");
  if (coupon.status !== "ACTIVE") throw new CouponConflict("COUPON_NOT_ACTIVE", "This coupon is not currently active.");
  if (coupon.startsAt > now) throw new CouponConflict("COUPON_NOT_STARTED", "This coupon is not available yet.");
  if (coupon.endsAt <= now) throw new CouponConflict("COUPON_EXPIRED", "This coupon has expired.");
  if (coupon.eligibleAccountType && coupon.eligibleAccountType !== input.accountType) throw new CouponConflict("COUPON_ACCOUNT_INELIGIBLE", "This coupon is not available for your account type.");
  if (input.subtotal.lt(coupon.minimumOrderAmount)) throw new CouponConflict("COUPON_MINIMUM_NOT_MET", `This coupon requires a minimum product total of BDT ${coupon.minimumOrderAmount.toFixed(2)}.`);
  if (coupon.totalUsageLimit !== null && coupon.redeemedCount >= coupon.totalUsageLimit) throw new CouponConflict("COUPON_LIMIT_REACHED", "This coupon has reached its usage limit.");

  const customerUses = await tx.couponRedemption.count({ where: { couponId: coupon.id, customerId: input.customerId } });
  if (customerUses >= coupon.perCustomerLimit) throw new CouponConflict("COUPON_CUSTOMER_LIMIT_REACHED", "You have already used this coupon the maximum number of times.");
  if (coupon.perDayLimit !== null) {
    const { start, end } = utcDayBounds(now);
    const dailyUses = await tx.couponRedemption.count({ where: { couponId: coupon.id, redeemedAt: { gte: start, lt: end } } });
    if (dailyUses >= coupon.perDayLimit) throw new CouponConflict("COUPON_DAILY_LIMIT_REACHED", "This coupon has reached today's usage limit.");
  }
  if (coupon.firstOrderOnly) {
    const priorOrders = await tx.order.count({ where: { customerId: input.customerId, status: { notIn: ["DRAFT", "CANCELLED", "REFUNDED"] } } });
    if (priorOrders > 0) throw new CouponConflict("COUPON_FIRST_ORDER_ONLY", "This coupon is available only for a customer's first order.");
  }

  let discountAmount = coupon.discountType === "PERCENTAGE"
    ? input.subtotal.mul(coupon.discountValue).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
    : coupon.discountValue;
  if (coupon.maximumDiscount && discountAmount.gt(coupon.maximumDiscount)) discountAmount = coupon.maximumDiscount;
  if (discountAmount.lte(0)) throw new CouponConflict("COUPON_ZERO_DISCOUNT", "This coupon does not produce a valid discount for the current cart.");
  if (discountAmount.gte(input.subtotal)) throw new CouponConflict("COUPON_EXCEEDS_ORDER_TOTAL", "This coupon would fully cover the product total and requires administrator adjustment.");

  return { couponId: coupon.id, code: coupon.code, name: coupon.name, discountType: coupon.discountType, discountValue: coupon.discountValue, discountAmount, allowsAutomaticStacking: coupon.allowsAutomaticStacking, version: coupon.version };
}

export async function claimCoupon(
  tx: Prisma.TransactionClient,
  input: CouponApplication & { customerId: string; orderId: string; subtotal: Prisma.Decimal; now?: Date },
) {
  const now = input.now ?? new Date();
  const lockKey = `coupon-redemption:${input.couponId}`;
  await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text AS "lockResult"`);
  const coupon = await tx.coupon.findUnique({ where: { id: input.couponId }, select: { totalUsageLimit: true, perDayLimit: true, perCustomerLimit: true } });
  if (!coupon) throw new CouponConflict("COUPON_NOT_FOUND", "This coupon code is not valid.");
  const customerUses = await tx.couponRedemption.count({ where: { couponId: input.couponId, customerId: input.customerId } });
  if (customerUses >= coupon.perCustomerLimit) throw new CouponConflict("COUPON_CUSTOMER_LIMIT_REACHED", "You have already used this coupon the maximum number of times.");
  if (coupon.perDayLimit !== null) {
    const { start, end } = utcDayBounds(now);
    const dailyUses = await tx.couponRedemption.count({ where: { couponId: input.couponId, redeemedAt: { gte: start, lt: end } } });
    if (dailyUses >= coupon.perDayLimit) throw new CouponConflict("COUPON_DAILY_LIMIT_REACHED", "This coupon has reached today's usage limit.");
  }

  const claimed = await tx.coupon.updateMany({
    where: {
      id: input.couponId,
      version: input.version,
      status: "ACTIVE",
      startsAt: { lte: now },
      endsAt: { gt: now },
      ...(coupon.totalUsageLimit === null ? {} : { redeemedCount: { lt: coupon.totalUsageLimit } }),
    },
    data: { redeemedCount: { increment: 1 } },
  });
  if (claimed.count !== 1) throw new CouponConflict("COUPON_CHANGED", "This coupon changed or reached its limit during checkout. Please try again.");

  return tx.couponRedemption.create({
    data: {
      couponId: input.couponId,
      orderId: input.orderId,
      customerId: input.customerId,
      couponCodeSnapshot: input.code,
      couponNameSnapshot: input.name,
      discountTypeSnapshot: input.discountType,
      discountValueSnapshot: input.discountValue,
      eligibleSubtotal: input.subtotal,
      discountAmount: input.discountAmount,
      couponVersion: input.version,
      redeemedAt: now,
    },
  });
}
