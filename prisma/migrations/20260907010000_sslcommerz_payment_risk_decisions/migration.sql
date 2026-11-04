CREATE TYPE "PaymentRiskDecisionType" AS ENUM ('APPROVED', 'REJECTED');

CREATE TABLE "PaymentRiskDecision" (
    "id" TEXT NOT NULL,
    "paymentIntentId" TEXT NOT NULL,
    "decision" "PaymentRiskDecisionType" NOT NULL,
    "reason" TEXT NOT NULL,
    "evidenceSnapshot" JSONB NOT NULL,
    "amountSnapshot" DECIMAL(12,2) NOT NULL,
    "currencySnapshot" TEXT NOT NULL,
    "reviewedById" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaymentRiskDecision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentRiskDecision_paymentIntentId_key" ON "PaymentRiskDecision"("paymentIntentId");
CREATE UNIQUE INDEX "PaymentRiskDecision_idempotencyKey_key" ON "PaymentRiskDecision"("idempotencyKey");
CREATE INDEX "PaymentRiskDecision_decision_reviewedAt_idx" ON "PaymentRiskDecision"("decision", "reviewedAt");
CREATE INDEX "PaymentRiskDecision_reviewedById_reviewedAt_idx" ON "PaymentRiskDecision"("reviewedById", "reviewedAt");

ALTER TABLE "PaymentRiskDecision" ADD CONSTRAINT "PaymentRiskDecision_paymentIntentId_fkey" FOREIGN KEY ("paymentIntentId") REFERENCES "PaymentIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentRiskDecision" ADD CONSTRAINT "PaymentRiskDecision_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION prevent_payment_risk_decision_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'PaymentRiskDecision records are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PaymentRiskDecision_immutable"
BEFORE UPDATE OR DELETE ON "PaymentRiskDecision"
FOR EACH ROW EXECUTE FUNCTION prevent_payment_risk_decision_mutation();
