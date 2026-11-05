ALTER TABLE "NotificationDelivery" ADD COLUMN "recipientHash" TEXT,
ADD COLUMN "providerEventAt" TIMESTAMP(3), ADD COLUMN "providerEventType" TEXT;
CREATE INDEX "NotificationDelivery_channel_providerReference_idx" ON "NotificationDelivery"("channel", "providerReference");

CREATE TABLE "EmailWebhookEvent" (
  "id" TEXT NOT NULL, "messageId" TEXT NOT NULL, "providerReference" TEXT NOT NULL,
  "eventType" TEXT NOT NULL, "payloadHash" TEXT NOT NULL, "occurredAt" TIMESTAMP(3) NOT NULL,
  "outcome" TEXT NOT NULL DEFAULT 'PENDING', "processedAt" TIMESTAMP(3), "deliveryId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailWebhookEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EmailWebhookEvent_messageId_key" ON "EmailWebhookEvent"("messageId");
CREATE INDEX "EmailWebhookEvent_providerReference_processedAt_idx" ON "EmailWebhookEvent"("providerReference", "processedAt");
CREATE INDEX "EmailWebhookEvent_createdAt_idx" ON "EmailWebhookEvent"("createdAt");
ALTER TABLE "EmailWebhookEvent" ADD CONSTRAINT "EmailWebhookEvent_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "NotificationDelivery"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "EmailSuppression" (
  "id" TEXT NOT NULL, "recipientHash" TEXT NOT NULL, "reason" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true, "version" INTEGER NOT NULL DEFAULT 1,
  "sourceDeliveryId" TEXT, "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL, "releasedAt" TIMESTAMP(3), "releasedById" TEXT,
  "releaseReason" TEXT, "evidenceReference" TEXT,
  CONSTRAINT "EmailSuppression_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EmailSuppression_recipientHash_key" ON "EmailSuppression"("recipientHash");
CREATE INDEX "EmailSuppression_active_lastSeenAt_idx" ON "EmailSuppression"("active", "lastSeenAt");
ALTER TABLE "EmailSuppression" ADD CONSTRAINT "EmailSuppression_sourceDeliveryId_fkey" FOREIGN KEY ("sourceDeliveryId") REFERENCES "NotificationDelivery"("id") ON DELETE SET NULL ON UPDATE CASCADE;
