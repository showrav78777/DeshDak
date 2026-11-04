CREATE TYPE "ProductReviewStatus" AS ENUM ('PENDING_MODERATION', 'PUBLISHED', 'REJECTED', 'REMOVED');
CREATE TYPE "ProductReviewDecision" AS ENUM ('PUBLISHED', 'REJECTED', 'REMOVED');

CREATE TABLE "ProductReview" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "orderItemId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "rating" INTEGER NOT NULL,
  "title" TEXT,
  "body" TEXT NOT NULL,
  "status" "ProductReviewStatus" NOT NULL DEFAULT 'PENDING_MODERATION',
  "verifiedPurchase" BOOLEAN NOT NULL DEFAULT true,
  "idempotencyKey" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "publishedAt" TIMESTAMP(3),
  "moderatedAt" TIMESTAMP(3),
  "moderatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductReview_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductReview_rating_check" CHECK ("rating" BETWEEN 1 AND 5),
  CONSTRAINT "ProductReview_published_state_check" CHECK (("status" = 'PUBLISHED' AND "publishedAt" IS NOT NULL) OR ("status" <> 'PUBLISHED'))
);

CREATE TABLE "ProductReviewModeration" (
  "id" TEXT NOT NULL,
  "reviewId" TEXT NOT NULL,
  "decision" "ProductReviewDecision" NOT NULL,
  "reason" TEXT,
  "moderatorId" TEXT NOT NULL,
  "reviewVersion" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductReviewModeration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductReview_orderItemId_key" ON "ProductReview"("orderItemId");
CREATE UNIQUE INDEX "ProductReview_idempotencyKey_key" ON "ProductReview"("idempotencyKey");
CREATE UNIQUE INDEX "ProductReview_id_version_key" ON "ProductReview"("id", "version");
CREATE INDEX "ProductReview_productId_status_publishedAt_idx" ON "ProductReview"("productId", "status", "publishedAt");
CREATE INDEX "ProductReview_customerId_createdAt_idx" ON "ProductReview"("customerId", "createdAt");
CREATE INDEX "ProductReview_status_createdAt_idx" ON "ProductReview"("status", "createdAt");
CREATE INDEX "ProductReview_moderatedById_idx" ON "ProductReview"("moderatedById");
CREATE INDEX "ProductReviewModeration_reviewId_createdAt_idx" ON "ProductReviewModeration"("reviewId", "createdAt");
CREATE INDEX "ProductReviewModeration_moderatorId_createdAt_idx" ON "ProductReviewModeration"("moderatorId", "createdAt");

ALTER TABLE "ProductReview" ADD CONSTRAINT "ProductReview_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductReview" ADD CONSTRAINT "ProductReview_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductReview" ADD CONSTRAINT "ProductReview_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductReview" ADD CONSTRAINT "ProductReview_moderatedById_fkey" FOREIGN KEY ("moderatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductReviewModeration" ADD CONSTRAINT "ProductReviewModeration_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "ProductReview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductReviewModeration" ADD CONSTRAINT "ProductReviewModeration_moderatorId_fkey" FOREIGN KEY ("moderatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
