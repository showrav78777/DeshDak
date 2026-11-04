CREATE TYPE "PaymentSettlementResolutionType" AS ENUM ('CONFIRMED_DUPLICATE', 'PROVIDER_REPORT_ERROR', 'PAYMENT_REFERENCE_CORRECTED', 'CHARGEBACK_CONFIRMED', 'MANUAL_EVIDENCE_ACCEPTED');
CREATE TYPE "PaymentSettlementResolutionDecisionType" AS ENUM ('APPROVED', 'REJECTED');

CREATE TABLE "PaymentSettlementResolutionProposal" (
  "id" TEXT NOT NULL,
  "settlementEntryId" TEXT NOT NULL,
  "resolutionType" "PaymentSettlementResolutionType" NOT NULL,
  "reason" TEXT NOT NULL,
  "evidenceReference" TEXT NOT NULL,
  "correctedPaymentReference" TEXT,
  "proposedById" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentSettlementResolutionProposal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentSettlementResolutionDecision" (
  "id" TEXT NOT NULL,
  "proposalId" TEXT NOT NULL,
  "settlementEntryId" TEXT NOT NULL,
  "decision" "PaymentSettlementResolutionDecisionType" NOT NULL,
  "reason" TEXT NOT NULL,
  "reviewedById" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentSettlementResolutionDecision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentSettlementResolutionProposal_idempotencyKey_key" ON "PaymentSettlementResolutionProposal"("idempotencyKey");
CREATE INDEX "PaymentSettlementResolutionProposal_settlementEntryId_proposedAt_idx" ON "PaymentSettlementResolutionProposal"("settlementEntryId", "proposedAt");
CREATE INDEX "PaymentSettlementResolutionProposal_proposedById_proposedAt_idx" ON "PaymentSettlementResolutionProposal"("proposedById", "proposedAt");
CREATE UNIQUE INDEX "PaymentSettlementResolutionDecision_proposalId_key" ON "PaymentSettlementResolutionDecision"("proposalId");
CREATE UNIQUE INDEX "PaymentSettlementResolutionDecision_idempotencyKey_key" ON "PaymentSettlementResolutionDecision"("idempotencyKey");
CREATE UNIQUE INDEX "PaymentSettlementResolutionDecision_one_approved_per_entry" ON "PaymentSettlementResolutionDecision"("settlementEntryId") WHERE "decision" = 'APPROVED';
CREATE INDEX "PaymentSettlementResolutionDecision_settlementEntryId_decision_reviewedAt_idx" ON "PaymentSettlementResolutionDecision"("settlementEntryId", "decision", "reviewedAt");
CREATE INDEX "PaymentSettlementResolutionDecision_reviewedById_reviewedAt_idx" ON "PaymentSettlementResolutionDecision"("reviewedById", "reviewedAt");

ALTER TABLE "PaymentSettlementResolutionProposal" ADD CONSTRAINT "PaymentSettlementResolutionProposal_settlementEntryId_fkey" FOREIGN KEY ("settlementEntryId") REFERENCES "PaymentSettlementEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentSettlementResolutionProposal" ADD CONSTRAINT "PaymentSettlementResolutionProposal_proposedById_fkey" FOREIGN KEY ("proposedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentSettlementResolutionDecision" ADD CONSTRAINT "PaymentSettlementResolutionDecision_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "PaymentSettlementResolutionProposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentSettlementResolutionDecision" ADD CONSTRAINT "PaymentSettlementResolutionDecision_settlementEntryId_fkey" FOREIGN KEY ("settlementEntryId") REFERENCES "PaymentSettlementEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentSettlementResolutionDecision" ADD CONSTRAINT "PaymentSettlementResolutionDecision_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION validate_payment_settlement_resolution_proposal() RETURNS trigger AS $$
DECLARE entry_status "PaymentSettlementMatchStatus";
BEGIN
  SELECT "matchStatus" INTO entry_status FROM "PaymentSettlementEntry" WHERE "id" = NEW."settlementEntryId" FOR UPDATE;
  IF entry_status IS NULL OR entry_status = 'MATCHED' THEN RAISE EXCEPTION 'Only settlement exceptions can receive resolution proposals'; END IF;
  IF EXISTS (SELECT 1 FROM "PaymentSettlementResolutionDecision" WHERE "settlementEntryId" = NEW."settlementEntryId" AND "decision" = 'APPROVED') THEN RAISE EXCEPTION 'Settlement exception is already resolved'; END IF;
  IF EXISTS (SELECT 1 FROM "PaymentSettlementResolutionProposal" p LEFT JOIN "PaymentSettlementResolutionDecision" d ON d."proposalId" = p."id" WHERE p."settlementEntryId" = NEW."settlementEntryId" AND d."id" IS NULL) THEN RAISE EXCEPTION 'Settlement exception already has a pending proposal'; END IF;
  IF NEW."resolutionType" = 'PAYMENT_REFERENCE_CORRECTED' AND (NEW."correctedPaymentReference" IS NULL OR length(trim(NEW."correctedPaymentReference")) < 3) THEN RAISE EXCEPTION 'Corrected payment reference is required'; END IF;
  IF NEW."resolutionType" <> 'PAYMENT_REFERENCE_CORRECTED' AND NEW."correctedPaymentReference" IS NOT NULL THEN RAISE EXCEPTION 'Corrected payment reference is not allowed'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION validate_payment_settlement_resolution_decision() RETURNS trigger AS $$
DECLARE proposal_entry TEXT; proposer TEXT;
BEGIN
  SELECT "settlementEntryId", "proposedById" INTO proposal_entry, proposer FROM "PaymentSettlementResolutionProposal" WHERE "id" = NEW."proposalId" FOR UPDATE;
  IF proposal_entry IS NULL OR proposal_entry <> NEW."settlementEntryId" THEN RAISE EXCEPTION 'Resolution decision does not match its proposal'; END IF;
  IF proposer = NEW."reviewedById" THEN RAISE EXCEPTION 'Resolution maker and checker must be different users'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION prevent_payment_settlement_resolution_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Payment settlement resolution evidence is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PaymentSettlementResolutionProposal_validate" BEFORE INSERT ON "PaymentSettlementResolutionProposal" FOR EACH ROW EXECUTE FUNCTION validate_payment_settlement_resolution_proposal();
CREATE TRIGGER "PaymentSettlementResolutionDecision_validate" BEFORE INSERT ON "PaymentSettlementResolutionDecision" FOR EACH ROW EXECUTE FUNCTION validate_payment_settlement_resolution_decision();
CREATE TRIGGER "PaymentSettlementResolutionProposal_immutable" BEFORE UPDATE OR DELETE ON "PaymentSettlementResolutionProposal" FOR EACH ROW EXECUTE FUNCTION prevent_payment_settlement_resolution_mutation();
CREATE TRIGGER "PaymentSettlementResolutionDecision_immutable" BEFORE UPDATE OR DELETE ON "PaymentSettlementResolutionDecision" FOR EACH ROW EXECUTE FUNCTION prevent_payment_settlement_resolution_mutation();
