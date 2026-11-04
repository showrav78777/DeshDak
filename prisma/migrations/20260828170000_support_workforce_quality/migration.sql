CREATE TYPE "SupportAgentAvailability" AS ENUM ('AVAILABLE', 'BUSY', 'OFFLINE');
CREATE TYPE "SupportQualityOutcome" AS ENUM ('PASS', 'COACHING_REQUIRED', 'ESCALATED');

CREATE TABLE "SupportAgentProfile" (
    "userId" TEXT NOT NULL,
    "availability" "SupportAgentAvailability" NOT NULL DEFAULT 'AVAILABLE',
    "acceptingNewTickets" BOOLEAN NOT NULL DEFAULT true,
    "maxActiveTickets" INTEGER NOT NULL DEFAULT 20,
    "languages" TEXT[] NOT NULL DEFAULT ARRAY['bn', 'en']::TEXT[],
    "statusNote" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SupportAgentProfile_pkey" PRIMARY KEY ("userId"),
    CONSTRAINT "SupportAgentProfile_capacity_check" CHECK ("maxActiveTickets" BETWEEN 1 AND 100)
);

CREATE TABLE "SupportQualityReview" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "outcome" "SupportQualityOutcome" NOT NULL,
    "summary" TEXT NOT NULL,
    "coachingAction" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SupportQualityReview_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SupportQualityReview_score_check" CHECK ("score" BETWEEN 1 AND 5)
);

CREATE UNIQUE INDEX "SupportQualityReview_ticketId_key" ON "SupportQualityReview"("ticketId");
CREATE INDEX "SupportAgentProfile_availability_acceptingNewTickets_idx" ON "SupportAgentProfile"("availability", "acceptingNewTickets");
CREATE INDEX "SupportAgentProfile_updatedById_updatedAt_idx" ON "SupportAgentProfile"("updatedById", "updatedAt");
CREATE INDEX "SupportQualityReview_agentId_reviewedAt_idx" ON "SupportQualityReview"("agentId", "reviewedAt");
CREATE INDEX "SupportQualityReview_reviewerId_reviewedAt_idx" ON "SupportQualityReview"("reviewerId", "reviewedAt");
CREATE INDEX "SupportQualityReview_outcome_reviewedAt_idx" ON "SupportQualityReview"("outcome", "reviewedAt");

ALTER TABLE "SupportAgentProfile" ADD CONSTRAINT "SupportAgentProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportAgentProfile" ADD CONSTRAINT "SupportAgentProfile_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupportQualityReview" ADD CONSTRAINT "SupportQualityReview_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupportQualityReview" ADD CONSTRAINT "SupportQualityReview_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupportQualityReview" ADD CONSTRAINT "SupportQualityReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
