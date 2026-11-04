CREATE TYPE "CouponStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'EXPIRED');
CREATE TYPE "CouponDiscountType" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT');

ALTER TABLE "Order" ADD COLUMN "checkoutRequestFingerprint" TEXT;

CREATE TABLE "Coupon" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
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
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CouponRedemption" (
    "id" TEXT NOT NULL,
    "couponId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "couponCodeSnapshot" TEXT NOT NULL,
    "couponNameSnapshot" TEXT NOT NULL,
    "discountTypeSnapshot" TEXT NOT NULL,
    "discountValueSnapshot" DECIMAL(12,2) NOT NULL,
    "eligibleSubtotal" DECIMAL(12,2) NOT NULL,
    "discountAmount" DECIMAL(12,2) NOT NULL,
    "couponVersion" INTEGER NOT NULL,
    "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CouponRedemption_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Coupon_code_key" ON "Coupon"("code");
CREATE INDEX "Coupon_status_startsAt_endsAt_idx" ON "Coupon"("status", "startsAt", "endsAt");
CREATE UNIQUE INDEX "CouponRedemption_orderId_key" ON "CouponRedemption"("orderId");
CREATE INDEX "CouponRedemption_couponId_customerId_redeemedAt_idx" ON "CouponRedemption"("couponId", "customerId", "redeemedAt");
CREATE INDEX "CouponRedemption_couponId_redeemedAt_idx" ON "CouponRedemption"("couponId", "redeemedAt");

ALTER TABLE "CouponRedemption" ADD CONSTRAINT "CouponRedemption_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CouponRedemption" ADD CONSTRAINT "CouponRedemption_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CouponRedemption" ADD CONSTRAINT "CouponRedemption_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_discountValue_positive" CHECK ("discountValue" > 0);
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_percentage_valid" CHECK ("discountType" <> 'PERCENTAGE' OR "discountValue" <= 100);
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_minimum_nonnegative" CHECK ("minimumOrderAmount" >= 0);
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_maximum_positive" CHECK ("maximumDiscount" IS NULL OR "maximumDiscount" > 0);
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_usage_limits_positive" CHECK (("totalUsageLimit" IS NULL OR "totalUsageLimit" > 0) AND "perCustomerLimit" > 0 AND ("perDayLimit" IS NULL OR "perDayLimit" > 0));
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_window_valid" CHECK ("endsAt" > "startsAt");
ALTER TABLE "CouponRedemption" ADD CONSTRAINT "CouponRedemption_amounts_valid" CHECK ("eligibleSubtotal" >= 0 AND "discountAmount" > 0 AND "discountAmount" <= "eligibleSubtotal");
