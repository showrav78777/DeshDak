ALTER TYPE "MarketingCampaignStatus" ADD VALUE IF NOT EXISTS 'SCHEDULED';
ALTER TYPE "MarketingCampaignStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';
ALTER TYPE "MarketingCampaignStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
ALTER TYPE "MarketingCampaignStatus" ADD VALUE IF NOT EXISTS 'FAILED';

ALTER TABLE "MarketingCampaign"
  ALTER COLUMN "sentAt" DROP DEFAULT,
  ALTER COLUMN "sentAt" DROP NOT NULL,
  ADD COLUMN "scheduledFor" TIMESTAMP(3),
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "failureCode" TEXT;

CREATE INDEX "MarketingCampaign_status_scheduledFor_idx" ON "MarketingCampaign"("status", "scheduledFor");
