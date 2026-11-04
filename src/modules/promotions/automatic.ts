import { Prisma, type CustomerAccountType } from "@prisma/client";
import { CouponConflict, utcDayBounds } from "@/modules/promotions/coupons";

export type AutomaticPromotionApplication = {
  promotionId: string;
  name: string;
  customerMessage: string;
  discountType: "PERCENTAGE" | "FIXED_AMOUNT";
  discountValue: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  allowsCouponStacking: boolean;
  priority: number;
  version: number;
};

function calculateDiscount(promotion: { discountType: string; discountValue: Prisma.Decimal; maximumDiscount: Prisma.Decimal | null }, subtotal: Prisma.Decimal) {
  let discount = promotion.discountType === "PERCENTAGE"
    ? subtotal.mul(promotion.discountValue).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
    : promotion.discountValue;
  if (promotion.maximumDiscount && discount.gt(promotion.maximumDiscount)) discount = promotion.maximumDiscount;
  return discount;
}

export async function evaluateAutomaticPromotion(
  tx: Prisma.TransactionClient,
  input: { customerId: string; accountType: CustomerAccountType; subtotal: Prisma.Decimal; now?: Date },
): Promise<AutomaticPromotionApplication | null> {
  const now = input.now ?? new Date();
  const candidates = await tx.automaticPromotion.findMany({
    where: {
      status: "ACTIVE",
      startsAt: { lte: now },
      endsAt: { gt: now },
      minimumOrderAmount: { lte: input.subtotal },
      OR: [{ eligibleAccountType: null }, { eligibleAccountType: input.accountType }],
    },
  });
  if (!candidates.length) return null;

  const ids = candidates.map((promotion) => promotion.id);
  const { start, end } = utcDayBounds(now);
  const [customerGroups, dailyGroups, priorOrders] = await Promise.all([
    tx.promotionApplication.groupBy({ by: ["promotionId"], where: { promotionId: { in: ids }, customerId: input.customerId }, _count: { _all: true } }),
    tx.promotionApplication.groupBy({ by: ["promotionId"], where: { promotionId: { in: ids }, appliedAt: { gte: start, lt: end } }, _count: { _all: true } }),
    candidates.some((promotion) => promotion.firstOrderOnly) ? tx.order.count({ where: { customerId: input.customerId, status: { notIn: ["DRAFT", "CANCELLED", "REFUNDED"] } } }) : Promise.resolve(0),
  ]);
  const customerUses = new Map(customerGroups.map((group) => [group.promotionId, group._count._all]));
  const dailyUses = new Map(dailyGroups.map((group) => [group.promotionId, group._count._all]));

  const eligible = candidates.flatMap((promotion) => {
    if (promotion.totalUsageLimit !== null && promotion.redeemedCount >= promotion.totalUsageLimit) return [];
    if ((customerUses.get(promotion.id) ?? 0) >= promotion.perCustomerLimit) return [];
    if (promotion.perDayLimit !== null && (dailyUses.get(promotion.id) ?? 0) >= promotion.perDayLimit) return [];
    if (promotion.firstOrderOnly && priorOrders > 0) return [];
    const discountAmount = calculateDiscount(promotion, input.subtotal);
    if (discountAmount.lte(0) || discountAmount.gte(input.subtotal)) return [];
    return [{ promotionId: promotion.id, name: promotion.name, customerMessage: promotion.customerMessage, discountType: promotion.discountType, discountValue: promotion.discountValue, discountAmount, allowsCouponStacking: promotion.allowsCouponStacking, priority: promotion.priority, version: promotion.version }];
  });
  eligible.sort((a, b) => b.discountAmount.comparedTo(a.discountAmount) || b.priority - a.priority || a.promotionId.localeCompare(b.promotionId));
  return eligible[0] ?? null;
}

export async function claimAutomaticPromotion(
  tx: Prisma.TransactionClient,
  input: AutomaticPromotionApplication & { customerId: string; orderId: string; subtotal: Prisma.Decimal; now?: Date },
) {
  const now = input.now ?? new Date();
  const lockKey = `automatic-promotion:${input.promotionId}`;
  await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text AS "lockResult"`);
  const promotion = await tx.automaticPromotion.findUnique({ where: { id: input.promotionId }, select: { totalUsageLimit: true, perDayLimit: true, perCustomerLimit: true } });
  if (!promotion) throw new CouponConflict("PROMOTION_CHANGED", "The automatic promotion is no longer available. Please retry checkout.");
  const customerUses = await tx.promotionApplication.count({ where: { promotionId: input.promotionId, customerId: input.customerId } });
  if (customerUses >= promotion.perCustomerLimit) throw new CouponConflict("PROMOTION_LIMIT_CHANGED", "The automatic promotion reached its customer limit. Please retry checkout.");
  if (promotion.perDayLimit !== null) {
    const { start, end } = utcDayBounds(now);
    const dailyUses = await tx.promotionApplication.count({ where: { promotionId: input.promotionId, appliedAt: { gte: start, lt: end } } });
    if (dailyUses >= promotion.perDayLimit) throw new CouponConflict("PROMOTION_LIMIT_CHANGED", "The automatic promotion reached today's limit. Please retry checkout.");
  }
  const claimed = await tx.automaticPromotion.updateMany({
    where: {
      id: input.promotionId,
      version: input.version,
      status: "ACTIVE",
      startsAt: { lte: now },
      endsAt: { gt: now },
      ...(promotion.totalUsageLimit === null ? {} : { redeemedCount: { lt: promotion.totalUsageLimit } }),
    },
    data: { redeemedCount: { increment: 1 } },
  });
  if (claimed.count !== 1) throw new CouponConflict("PROMOTION_CHANGED", "The automatic promotion changed or reached its limit. Please retry checkout.");
  return tx.promotionApplication.create({ data: {
    promotionId: input.promotionId,
    orderId: input.orderId,
    customerId: input.customerId,
    promotionNameSnapshot: input.name,
    customerMessageSnapshot: input.customerMessage,
    discountTypeSnapshot: input.discountType,
    discountValueSnapshot: input.discountValue,
    eligibleSubtotal: input.subtotal,
    discountAmount: input.discountAmount,
    promotionVersion: input.version,
    appliedAt: now,
  } });
}
