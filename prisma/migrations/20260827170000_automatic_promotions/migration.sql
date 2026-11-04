ALTER TABLE "Coupon" ADD COLUMN "allowsAutomaticStacking" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "AutomaticPromotion" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "internalDescription" TEXT,
    "customerMessage" TEXT NOT NULL,
    "status" "CouponStatus" NOT NULL DEFAULT 'DRAFT',
    "discountType" "CouponDiscountType" NOT NULL,
    "discountValue" DECIMAL(12,2) NOT NULL,
    "minimumOrderAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "maximumDiscount" DECIMAL(12,2),
    "totalUsageLimit" INTEGER,
    "perCustomerLimit" INTEGER NOT NULL DEFAULT 1,
    "perDayLimit" INTEGER,
    "redeemedCount" INTEGER NOT NULL DEFAULT 0,
    "eligibleAccountType" "CustomerAccountType",
    "firstOrderOnly" BOOLEAN NOT NULL DEFAULT false,
    "allowsCouponStacking" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AutomaticPromotion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PromotionApplication" (
    "id" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "promotionNameSnapshot" TEXT NOT NULL,
    "customerMessageSnapshot" TEXT NOT NULL,
    "discountTypeSnapshot" TEXT NOT NULL,
    "discountValueSnapshot" DECIMAL(12,2) NOT NULL,
    "eligibleSubtotal" DECIMAL(12,2) NOT NULL,
    "discountAmount" DECIMAL(12,2) NOT NULL,
    "promotionVersion" INTEGER NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PromotionApplication_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AutomaticPromotion_status_startsAt_endsAt_priority_idx" ON "AutomaticPromotion"("status", "startsAt", "endsAt", "priority");
CREATE UNIQUE INDEX "PromotionApplication_orderId_key" ON "PromotionApplication"("orderId");
CREATE INDEX "PromotionApplication_promotionId_customerId_appliedAt_idx" ON "PromotionApplication"("promotionId", "customerId", "appliedAt");
CREATE INDEX "PromotionApplication_promotionId_appliedAt_idx" ON "PromotionApplication"("promotionId", "appliedAt");

ALTER TABLE "PromotionApplication" ADD CONSTRAINT "PromotionApplication_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "AutomaticPromotion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PromotionApplication" ADD CONSTRAINT "PromotionApplication_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PromotionApplication" ADD CONSTRAINT "PromotionApplication_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AutomaticPromotion" ADD CONSTRAINT "AutomaticPromotion_discountValue_positive" CHECK ("discountValue" > 0);
ALTER TABLE "AutomaticPromotion" ADD CONSTRAINT "AutomaticPromotion_percentage_valid" CHECK ("discountType" <> 'PERCENTAGE' OR "discountValue" <= 100);
ALTER TABLE "AutomaticPromotion" ADD CONSTRAINT "AutomaticPromotion_minimum_nonnegative" CHECK ("minimumOrderAmount" >= 0);
ALTER TABLE "AutomaticPromotion" ADD CONSTRAINT "AutomaticPromotion_maximum_positive" CHECK ("maximumDiscount" IS NULL OR "maximumDiscount" > 0);
ALTER TABLE "AutomaticPromotion" ADD CONSTRAINT "AutomaticPromotion_usage_limits_positive" CHECK (("totalUsageLimit" IS NULL OR "totalUsageLimit" > 0) AND "perCustomerLimit" > 0 AND ("perDayLimit" IS NULL OR "perDayLimit" > 0));
ALTER TABLE "AutomaticPromotion" ADD CONSTRAINT "AutomaticPromotion_window_valid" CHECK ("endsAt" > "startsAt");
ALTER TABLE "PromotionApplication" ADD CONSTRAINT "PromotionApplication_amounts_valid" CHECK ("eligibleSubtotal" >= 0 AND "discountAmount" > 0 AND "discountAmount" <= "eligibleSubtotal");
