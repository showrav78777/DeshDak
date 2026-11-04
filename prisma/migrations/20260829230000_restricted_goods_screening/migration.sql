CREATE TYPE "RestrictedGoodsRuleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');
CREATE TYPE "RestrictedGoodsAction" AS ENUM ('BLOCK', 'MANUAL_REVIEW');
CREATE TYPE "ComplianceScreeningSubject" AS ENUM ('SOURCING_REQUEST', 'CHECKOUT');
CREATE TYPE "ComplianceScreeningOutcome" AS ENUM ('CLEAR', 'BLOCKED', 'REVIEW_REQUIRED', 'APPROVED', 'REJECTED');

CREATE TABLE "RestrictedGoodsRule" (
    "id" TEXT NOT NULL,
    "ruleCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "internalDescription" TEXT,
    "customerMessage" TEXT NOT NULL,
    "action" "RestrictedGoodsAction" NOT NULL,
    "status" "RestrictedGoodsRuleStatus" NOT NULL DEFAULT 'DRAFT',
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "hsCodePrefixes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "originCountryCode" TEXT,
    "destinationCountryCode" TEXT,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "legalReference" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RestrictedGoodsRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ComplianceScreeningAttempt" (
    "id" TEXT NOT NULL,
    "subject" "ComplianceScreeningSubject" NOT NULL,
    "subjectReference" TEXT,
    "customerId" TEXT NOT NULL,
    "originCountryCode" TEXT,
    "destinationCountryCode" TEXT,
    "inputHash" TEXT NOT NULL,
    "matchedRuleCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "outcome" "ComplianceScreeningOutcome" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "reviewedById" TEXT,
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ComplianceScreeningAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RestrictedGoodsRule_ruleCode_key" ON "RestrictedGoodsRule"("ruleCode");
CREATE INDEX "RestrictedGoodsRule_status_effectiveFrom_effectiveTo_idx" ON "RestrictedGoodsRule"("status", "effectiveFrom", "effectiveTo");
CREATE INDEX "RestrictedGoodsRule_originCountryCode_destinationCountryCode_status_idx" ON "RestrictedGoodsRule"("originCountryCode", "destinationCountryCode", "status");
CREATE INDEX "ComplianceScreeningAttempt_outcome_createdAt_idx" ON "ComplianceScreeningAttempt"("outcome", "createdAt");
CREATE INDEX "ComplianceScreeningAttempt_customerId_inputHash_outcome_idx" ON "ComplianceScreeningAttempt"("customerId", "inputHash", "outcome");
CREATE INDEX "ComplianceScreeningAttempt_subject_subjectReference_idx" ON "ComplianceScreeningAttempt"("subject", "subjectReference");
