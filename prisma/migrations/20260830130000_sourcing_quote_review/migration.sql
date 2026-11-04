ALTER TABLE "SourcingQuote"
ADD COLUMN "reviewedById" TEXT,
ADD COLUMN "reviewedAt" TIMESTAMP(3),
ADD COLUMN "reviewNote" TEXT;

ALTER TABLE "SourcingQuote"
ADD CONSTRAINT "SourcingQuote_reviewedById_fkey"
FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "SourcingQuote_status_reviewedAt_idx"
ON "SourcingQuote"("status", "reviewedAt");
