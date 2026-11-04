CREATE TYPE "PaymentSettlementBatchStatus" AS ENUM ('RECONCILED', 'EXCEPTIONS');
CREATE TYPE "PaymentSettlementMatchStatus" AS ENUM ('MATCHED', 'PAYMENT_NOT_FOUND', 'PAYMENT_NOT_SUCCEEDED', 'AMOUNT_MISMATCH', 'CURRENCY_MISMATCH', 'DUPLICATE_TRANSACTION', 'REVIEW_REQUIRED');

CREATE TABLE "PaymentSettlementBatch" (
  "id" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "externalBatchReference" TEXT NOT NULL,
  "settlementDate" TIMESTAMP(3) NOT NULL,
  "currency" TEXT NOT NULL,
  "status" "PaymentSettlementBatchStatus" NOT NULL,
  "sourceFingerprint" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "importedById" TEXT NOT NULL,
  "rowCount" INTEGER NOT NULL,
  "matchedCount" INTEGER NOT NULL,
  "exceptionCount" INTEGER NOT NULL,
  "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentSettlementBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentSettlementEntry" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "rowNumber" INTEGER NOT NULL,
  "externalTransactionId" TEXT NOT NULL,
  "bankTransactionId" TEXT,
  "grossAmount" DECIMAL(12,2) NOT NULL,
  "gatewayFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "netAmount" DECIMAL(12,2) NOT NULL,
  "currency" TEXT NOT NULL,
  "settledAt" TIMESTAMP(3) NOT NULL,
  "matchStatus" "PaymentSettlementMatchStatus" NOT NULL,
  "exceptionReason" TEXT,
  "paymentIntentId" TEXT,
  "evidenceFingerprint" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentSettlementEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentSettlementBatch_reference_key" ON "PaymentSettlementBatch"("reference");
CREATE UNIQUE INDEX "PaymentSettlementBatch_sourceFingerprint_key" ON "PaymentSettlementBatch"("sourceFingerprint");
CREATE UNIQUE INDEX "PaymentSettlementBatch_idempotencyKey_key" ON "PaymentSettlementBatch"("idempotencyKey");
CREATE UNIQUE INDEX "PaymentSettlementBatch_provider_externalBatchReference_key" ON "PaymentSettlementBatch"("provider", "externalBatchReference");
CREATE INDEX "PaymentSettlementBatch_status_settlementDate_idx" ON "PaymentSettlementBatch"("status", "settlementDate");
CREATE INDEX "PaymentSettlementBatch_importedById_importedAt_idx" ON "PaymentSettlementBatch"("importedById", "importedAt");
CREATE UNIQUE INDEX "PaymentSettlementEntry_batchId_rowNumber_key" ON "PaymentSettlementEntry"("batchId", "rowNumber");
CREATE INDEX "PaymentSettlementEntry_matchStatus_createdAt_idx" ON "PaymentSettlementEntry"("matchStatus", "createdAt");
CREATE INDEX "PaymentSettlementEntry_externalTransactionId_idx" ON "PaymentSettlementEntry"("externalTransactionId");
CREATE INDEX "PaymentSettlementEntry_paymentIntentId_idx" ON "PaymentSettlementEntry"("paymentIntentId");

ALTER TABLE "PaymentSettlementBatch" ADD CONSTRAINT "PaymentSettlementBatch_importedById_fkey" FOREIGN KEY ("importedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentSettlementEntry" ADD CONSTRAINT "PaymentSettlementEntry_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PaymentSettlementBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentSettlementEntry" ADD CONSTRAINT "PaymentSettlementEntry_paymentIntentId_fkey" FOREIGN KEY ("paymentIntentId") REFERENCES "PaymentIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION prevent_payment_settlement_evidence_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Payment settlement evidence is immutable';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "PaymentSettlementBatch_immutable" BEFORE UPDATE OR DELETE ON "PaymentSettlementBatch" FOR EACH ROW EXECUTE FUNCTION prevent_payment_settlement_evidence_mutation();
CREATE TRIGGER "PaymentSettlementEntry_immutable" BEFORE UPDATE OR DELETE ON "PaymentSettlementEntry" FOR EACH ROW EXECUTE FUNCTION prevent_payment_settlement_evidence_mutation();
