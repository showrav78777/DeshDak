-- Expand-only refund calculation evidence. Nullable columns preserve existing records;
-- application writes are required for all new refunds before a later reviewed contract migration.
ALTER TABLE "Refund"
  ADD COLUMN "requestedBaseAmount" DECIMAL(18,2),
  ADD COLUMN "promotionNettingBaseAmount" DECIMAL(18,2),
  ADD COLUMN "netBaseAmount" DECIMAL(18,2),
  ADD COLUMN "baseCurrency" TEXT,
  ADD COLUMN "calculationVersion" TEXT,
  ADD COLUMN "requestFingerprint" TEXT;

CREATE UNIQUE INDEX "Refund_requestFingerprint_key" ON "Refund"("requestFingerprint");
