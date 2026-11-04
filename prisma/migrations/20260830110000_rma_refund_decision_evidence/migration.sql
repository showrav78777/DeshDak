ALTER TABLE "Rma"
ADD COLUMN "refundDecisionById" TEXT,
ADD COLUMN "refundDecisionAt" TIMESTAMP(3);

ALTER TABLE "Rma"
ADD CONSTRAINT "Rma_refundDecisionById_fkey"
FOREIGN KEY ("refundDecisionById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Rma_refundDecisionById_refundDecisionAt_idx"
ON "Rma"("refundDecisionById", "refundDecisionAt");
