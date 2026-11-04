ALTER TYPE "RefundStatus" ADD VALUE 'PROCESSING' AFTER 'APPROVED';

CREATE TYPE "RefundGatewayOperationType" AS ENUM ('INITIATE', 'STATUS_QUERY');

ALTER TABLE "Refund"
  ADD COLUMN "providerRefundReference" TEXT,
  ADD COLUMN "providerRefundTransactionId" TEXT,
  ADD COLUMN "providerStatus" TEXT,
  ADD COLUMN "providerStatusCheckedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Refund_providerRefundReference_key" ON "Refund"("providerRefundReference");
CREATE UNIQUE INDEX "Refund_providerRefundTransactionId_key" ON "Refund"("providerRefundTransactionId");

CREATE TABLE "RefundGatewayOperation" (
  "id" TEXT NOT NULL,
  "refundId" TEXT NOT NULL,
  "operation" "RefundGatewayOperationType" NOT NULL,
  "provider" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "providerStatus" TEXT,
  "providerRefundReference" TEXT,
  "providerTransactionId" TEXT,
  "bankTransactionId" TEXT,
  "responseEvidence" JSONB,
  "idempotencyKey" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RefundGatewayOperation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RefundGatewayOperation_idempotencyKey_key" ON "RefundGatewayOperation"("idempotencyKey");
CREATE INDEX "RefundGatewayOperation_refundId_occurredAt_idx" ON "RefundGatewayOperation"("refundId", "occurredAt");
CREATE INDEX "RefundGatewayOperation_provider_providerStatus_occurredAt_idx" ON "RefundGatewayOperation"("provider", "providerStatus", "occurredAt");
CREATE INDEX "RefundGatewayOperation_actorId_occurredAt_idx" ON "RefundGatewayOperation"("actorId", "occurredAt");
ALTER TABLE "RefundGatewayOperation" ADD CONSTRAINT "RefundGatewayOperation_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "Refund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RefundGatewayOperation" ADD CONSTRAINT "RefundGatewayOperation_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION prevent_refund_gateway_operation_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Refund gateway operation evidence is immutable';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "RefundGatewayOperation_immutable" BEFORE UPDATE OR DELETE ON "RefundGatewayOperation" FOR EACH ROW EXECUTE FUNCTION prevent_refund_gateway_operation_mutation();
