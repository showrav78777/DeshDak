CREATE TYPE "ReelStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'REJECTED', 'ARCHIVED');
CREATE TYPE "ReelEngagementType" AS ENUM ('VIEW', 'SHARE', 'PRODUCT_CLICK');
CREATE TYPE "ReelReactionType" AS ENUM ('LIKE', 'SAVE');
CREATE TYPE "ReelCommentStatus" AS ENUM ('PENDING_MODERATION', 'PUBLISHED', 'REJECTED', 'REMOVED');

CREATE TABLE "Reel" (
  "id" TEXT NOT NULL,
  "reelCode" TEXT NOT NULL DEFAULT ('REL-' || UPPER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', '') FROM 1 FOR 20))),
  "sellerProfileId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "mediaId" TEXT NOT NULL,
  "caption" TEXT,
  "status" "ReelStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
  "reviewNote" TEXT,
  "moderatedById" TEXT,
  "moderatedAt" TIMESTAMP(3),
  "publishedAt" TIMESTAMP(3),
  "viewCount" INTEGER NOT NULL DEFAULT 0,
  "completedViewCount" INTEGER NOT NULL DEFAULT 0,
  "totalWatchTimeMs" BIGINT NOT NULL DEFAULT 0,
  "likeCount" INTEGER NOT NULL DEFAULT 0,
  "saveCount" INTEGER NOT NULL DEFAULT 0,
  "commentCount" INTEGER NOT NULL DEFAULT 0,
  "shareCount" INTEGER NOT NULL DEFAULT 0,
  "productClickCount" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Reel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReelEngagement" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "reelId" TEXT NOT NULL,
  "userId" TEXT,
  "authSessionId" TEXT,
  "type" "ReelEngagementType" NOT NULL,
  "watchTimeMs" INTEGER,
  "durationMs" INTEGER,
  "completionPercent" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReelEngagement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReelReaction" (
  "id" TEXT NOT NULL,
  "reelId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" "ReelReactionType" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReelReaction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReelComment" (
  "id" TEXT NOT NULL,
  "reelId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "status" "ReelCommentStatus" NOT NULL DEFAULT 'PENDING_MODERATION',
  "reviewNote" TEXT,
  "moderatedById" TEXT,
  "moderatedAt" TIMESTAMP(3),
  "publishedAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReelComment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Reel_reelCode_key" ON "Reel"("reelCode");
CREATE UNIQUE INDEX "Reel_mediaId_key" ON "Reel"("mediaId");
CREATE INDEX "Reel_status_publishedAt_createdAt_idx" ON "Reel"("status", "publishedAt", "createdAt");
CREATE INDEX "Reel_sellerProfileId_status_createdAt_idx" ON "Reel"("sellerProfileId", "status", "createdAt");
CREATE INDEX "Reel_productId_status_idx" ON "Reel"("productId", "status");
CREATE UNIQUE INDEX "ReelEngagement_idempotencyKey_key" ON "ReelEngagement"("idempotencyKey");
CREATE INDEX "ReelEngagement_reelId_type_createdAt_idx" ON "ReelEngagement"("reelId", "type", "createdAt");
CREATE INDEX "ReelEngagement_userId_type_createdAt_idx" ON "ReelEngagement"("userId", "type", "createdAt");
CREATE INDEX "ReelEngagement_authSessionId_createdAt_idx" ON "ReelEngagement"("authSessionId", "createdAt");
CREATE UNIQUE INDEX "ReelReaction_reelId_userId_type_key" ON "ReelReaction"("reelId", "userId", "type");
CREATE INDEX "ReelReaction_userId_type_createdAt_idx" ON "ReelReaction"("userId", "type", "createdAt");
CREATE INDEX "ReelComment_reelId_status_publishedAt_createdAt_idx" ON "ReelComment"("reelId", "status", "publishedAt", "createdAt");
CREATE INDEX "ReelComment_authorId_createdAt_idx" ON "ReelComment"("authorId", "createdAt");
CREATE INDEX "ReelComment_status_createdAt_idx" ON "ReelComment"("status", "createdAt");

ALTER TABLE "Reel" ADD CONSTRAINT "Reel_sellerProfileId_fkey" FOREIGN KEY ("sellerProfileId") REFERENCES "SellerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Reel" ADD CONSTRAINT "Reel_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Reel" ADD CONSTRAINT "Reel_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "ProductMedia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Reel" ADD CONSTRAINT "Reel_moderatedById_fkey" FOREIGN KEY ("moderatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ReelEngagement" ADD CONSTRAINT "ReelEngagement_reelId_fkey" FOREIGN KEY ("reelId") REFERENCES "Reel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReelEngagement" ADD CONSTRAINT "ReelEngagement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ReelEngagement" ADD CONSTRAINT "ReelEngagement_authSessionId_fkey" FOREIGN KEY ("authSessionId") REFERENCES "AuthSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ReelReaction" ADD CONSTRAINT "ReelReaction_reelId_fkey" FOREIGN KEY ("reelId") REFERENCES "Reel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReelReaction" ADD CONSTRAINT "ReelReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReelComment" ADD CONSTRAINT "ReelComment_reelId_fkey" FOREIGN KEY ("reelId") REFERENCES "Reel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReelComment" ADD CONSTRAINT "ReelComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReelComment" ADD CONSTRAINT "ReelComment_moderatedById_fkey" FOREIGN KEY ("moderatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
