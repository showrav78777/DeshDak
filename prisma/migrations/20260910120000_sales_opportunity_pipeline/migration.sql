CREATE TYPE "SalesOpportunityStage" AS ENUM ('DISCOVERY', 'QUALIFIED', 'QUOTED', 'NEGOTIATION', 'WON', 'LOST');

CREATE TABLE "SalesOpportunity" (
  "id" TEXT NOT NULL,
  "opportunityCode" TEXT NOT NULL DEFAULT ('OPP-' || UPPER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', '') FROM 1 FOR 20))),
  "accountId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "sourcingRequestId" TEXT,
  "title" TEXT NOT NULL,
  "stage" "SalesOpportunityStage" NOT NULL DEFAULT 'DISCOVERY',
  "idempotencyKey" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "estimatedValue" DECIMAL(14,2),
  "currency" TEXT,
  "expectedCloseAt" TIMESTAMP(3),
  "note" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SalesOpportunity_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SalesOpportunity_code_format_check" CHECK ("opportunityCode" ~ '^OPP-[A-F0-9]{20}$'),
  CONSTRAINT "SalesOpportunity_value_check" CHECK ("estimatedValue" IS NULL OR "estimatedValue" > 0),
  CONSTRAINT "SalesOpportunity_currency_check" CHECK (("estimatedValue" IS NULL AND "currency" IS NULL) OR ("estimatedValue" IS NOT NULL AND "currency" ~ '^[A-Z]{3}$'))
);

CREATE TABLE "OpportunityStageChange" (
  "id" TEXT NOT NULL,
  "opportunityId" TEXT NOT NULL,
  "fromStage" "SalesOpportunityStage",
  "toStage" "SalesOpportunityStage" NOT NULL,
  "actorId" TEXT NOT NULL,
  "note" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OpportunityStageChange_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SalesOpportunity_opportunityCode_key" ON "SalesOpportunity"("opportunityCode");
CREATE UNIQUE INDEX "SalesOpportunity_sourcingRequestId_key" ON "SalesOpportunity"("sourcingRequestId");
CREATE UNIQUE INDEX "SalesOpportunity_idempotencyKey_key" ON "SalesOpportunity"("idempotencyKey");
CREATE INDEX "SalesOpportunity_accountId_stage_updatedAt_idx" ON "SalesOpportunity"("accountId", "stage", "updatedAt");
CREATE INDEX "SalesOpportunity_ownerId_stage_updatedAt_idx" ON "SalesOpportunity"("ownerId", "stage", "updatedAt");
CREATE INDEX "SalesOpportunity_expectedCloseAt_idx" ON "SalesOpportunity"("expectedCloseAt");
CREATE UNIQUE INDEX "OpportunityStageChange_idempotencyKey_key" ON "OpportunityStageChange"("idempotencyKey");
CREATE INDEX "OpportunityStageChange_opportunityId_createdAt_idx" ON "OpportunityStageChange"("opportunityId", "createdAt");
CREATE INDEX "OpportunityStageChange_actorId_createdAt_idx" ON "OpportunityStageChange"("actorId", "createdAt");

ALTER TABLE "SalesOpportunity" ADD CONSTRAINT "SalesOpportunity_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "BusinessAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalesOpportunity" ADD CONSTRAINT "SalesOpportunity_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalesOpportunity" ADD CONSTRAINT "SalesOpportunity_sourcingRequestId_fkey" FOREIGN KEY ("sourcingRequestId") REFERENCES "SourcingRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OpportunityStageChange" ADD CONSTRAINT "OpportunityStageChange_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "SalesOpportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OpportunityStageChange" ADD CONSTRAINT "OpportunityStageChange_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION prevent_opportunity_stage_change_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Opportunity stage history is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "OpportunityStageChange_immutable_update"
BEFORE UPDATE ON "OpportunityStageChange"
FOR EACH ROW EXECUTE FUNCTION prevent_opportunity_stage_change_mutation();

CREATE TRIGGER "OpportunityStageChange_immutable_delete"
BEFORE DELETE ON "OpportunityStageChange"
FOR EACH ROW EXECUTE FUNCTION prevent_opportunity_stage_change_mutation();
