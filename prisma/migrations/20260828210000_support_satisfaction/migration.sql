CREATE TABLE "SupportSatisfactionRating" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "issueResolved" BOOLEAN NOT NULL,
    "comment" TEXT,
    "ticketVersion" INTEGER NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupportSatisfactionRating_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SupportSatisfactionRating_score_check" CHECK ("score" BETWEEN 1 AND 5)
);

CREATE UNIQUE INDEX "SupportSatisfactionRating_ticketId_key" ON "SupportSatisfactionRating"("ticketId");
CREATE UNIQUE INDEX "SupportSatisfactionRating_idempotencyKey_key" ON "SupportSatisfactionRating"("idempotencyKey");
CREATE INDEX "SupportSatisfactionRating_agentId_submittedAt_idx" ON "SupportSatisfactionRating"("agentId", "submittedAt");
CREATE INDEX "SupportSatisfactionRating_customerId_submittedAt_idx" ON "SupportSatisfactionRating"("customerId", "submittedAt");
CREATE INDEX "SupportSatisfactionRating_score_submittedAt_idx" ON "SupportSatisfactionRating"("score", "submittedAt");

ALTER TABLE "SupportSatisfactionRating" ADD CONSTRAINT "SupportSatisfactionRating_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupportSatisfactionRating" ADD CONSTRAINT "SupportSatisfactionRating_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupportSatisfactionRating" ADD CONSTRAINT "SupportSatisfactionRating_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
