-- Make origin-country and Bangladesh last-mile delivery charges explicit and auditable.
ALTER TABLE "SourcingQuote" ADD COLUMN "originDeliveryBdt" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "ShippingQuote" ADD COLUMN "lastMileRatePerKgBdt" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "ShippingQuote" ADD COLUMN "lastMileDeliveryBdt" DECIMAL(12,2) NOT NULL DEFAULT 0;
