CREATE TYPE "ProductRevisionStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'WITHDRAWN');

ALTER TABLE "Product"
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "ProductRevision" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "sellerProfileId" TEXT NOT NULL,
  "status" "ProductRevisionStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
  "baseProductVersion" INTEGER NOT NULL,
  "productPayload" JSONB NOT NULL,
  "variantPayload" JSONB NOT NULL,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "reviewerId" TEXT,
  "reviewNote" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductRevision_baseProductVersion_check" CHECK ("baseProductVersion" > 0),
  CONSTRAINT "ProductRevision_version_check" CHECK ("version" > 0)
);

CREATE INDEX "ProductRevision_productId_status_submittedAt_idx"
ON "ProductRevision"("productId", "status", "submittedAt");

CREATE INDEX "ProductRevision_sellerProfileId_status_submittedAt_idx"
ON "ProductRevision"("sellerProfileId", "status", "submittedAt");

-- A product can have only one moderation request in flight. This avoids
-- conflicting seller edits and makes retry behavior deterministic.
CREATE UNIQUE INDEX "ProductRevision_one_pending_per_product_key"
ON "ProductRevision"("productId")
WHERE "status" = 'PENDING_REVIEW';

ALTER TABLE "ProductRevision" ADD CONSTRAINT "ProductRevision_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProductRevision" ADD CONSTRAINT "ProductRevision_sellerProfileId_fkey"
FOREIGN KEY ("sellerProfileId") REFERENCES "SellerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProductRevision" ADD CONSTRAINT "ProductRevision_reviewerId_fkey"
FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
