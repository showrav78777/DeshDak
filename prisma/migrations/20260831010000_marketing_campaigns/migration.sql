CREATE TYPE "MarketingCampaignStatus" AS ENUM ('SENT');

CREATE TABLE "MarketingCampaign" (
  "id" TEXT NOT NULL,
  "campaignCode" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "titleBn" TEXT,
  "bodyBn" TEXT,
  "deepLink" TEXT,
  "audienceAccountType" "CustomerAccountType",
  "audienceLocale" TEXT,
  "targetUserId" TEXT,
  "status" "MarketingCampaignStatus" NOT NULL DEFAULT 'SENT',
  "matchedConsentCount" INTEGER NOT NULL,
  "frequencySuppressedCount" INTEGER NOT NULL,
  "recipientCount" INTEGER NOT NULL,
  "createdById" TEXT NOT NULL,
  "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketingCampaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MarketingCampaignRecipient" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "notificationId" TEXT NOT NULL,
  "localeSnapshot" TEXT NOT NULL,
  "accountTypeSnapshot" "CustomerAccountType" NOT NULL,
  "consentPreferenceId" TEXT NOT NULL,
  "consentPreferenceUpdatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketingCampaignRecipient_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MarketingCampaign_campaignCode_key" ON "MarketingCampaign"("campaignCode");
CREATE UNIQUE INDEX "MarketingCampaign_idempotencyKey_key" ON "MarketingCampaign"("idempotencyKey");
CREATE INDEX "MarketingCampaign_sentAt_idx" ON "MarketingCampaign"("sentAt");
CREATE INDEX "MarketingCampaign_createdById_sentAt_idx" ON "MarketingCampaign"("createdById", "sentAt");
CREATE UNIQUE INDEX "MarketingCampaignRecipient_notificationId_key" ON "MarketingCampaignRecipient"("notificationId");
CREATE UNIQUE INDEX "MarketingCampaignRecipient_campaignId_userId_key" ON "MarketingCampaignRecipient"("campaignId", "userId");
CREATE INDEX "MarketingCampaignRecipient_userId_createdAt_idx" ON "MarketingCampaignRecipient"("userId", "createdAt");

ALTER TABLE "MarketingCampaign" ADD CONSTRAINT "MarketingCampaign_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketingCampaignRecipient" ADD CONSTRAINT "MarketingCampaignRecipient_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketingCampaignRecipient" ADD CONSTRAINT "MarketingCampaignRecipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketingCampaignRecipient" ADD CONSTRAINT "MarketingCampaignRecipient_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
