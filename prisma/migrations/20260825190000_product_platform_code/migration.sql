-- Expand first so existing rows remain readable during a rolling deployment.
ALTER TABLE "Product" ADD COLUMN "productCode" TEXT;

-- Existing UUIDs are already unique. The full normalized value makes the
-- transitional backfill deterministic and collision-free.
UPDATE "Product"
SET "productCode" = 'PRD-' || UPPER(REPLACE("id", '-', ''))
WHERE "productCode" IS NULL;

CREATE UNIQUE INDEX "Product_productCode_key" ON "Product"("productCode");
