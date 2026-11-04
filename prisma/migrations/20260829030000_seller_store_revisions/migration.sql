CREATE TYPE "SellerStoreRevisionStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'WITHDRAWN');

ALTER TABLE "SellerProfile"
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "SellerStoreRevision" (
  "id" TEXT NOT NULL,
  "sellerProfileId" TEXT NOT NULL,
  "status" "SellerStoreRevisionStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
  "baseSellerVersion" INTEGER NOT NULL,
  "businessName" TEXT NOT NULL,
  "storeDescription" TEXT NOT NULL,
  "processingDays" INTEGER NOT NULL,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "reviewerId" TEXT,
  "reviewNote" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SellerStoreRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SellerStoreRevision_baseSellerVersion_check" CHECK ("baseSellerVersion" > 0),
  CONSTRAINT "SellerStoreRevision_processingDays_check" CHECK ("processingDays" BETWEEN 1 AND 30),
  CONSTRAINT "SellerStoreRevision_version_check" CHECK ("version" > 0)
);

CREATE INDEX "SellerStoreRevision_sellerProfileId_status_submittedAt_idx"
ON "SellerStoreRevision"("sellerProfileId", "status", "submittedAt");

CREATE UNIQUE INDEX "SellerStoreRevision_one_pending_per_seller_key"
ON "SellerStoreRevision"("sellerProfileId")
WHERE "status" = 'PENDING_REVIEW';

ALTER TABLE "SellerStoreRevision" ADD CONSTRAINT "SellerStoreRevision_sellerProfileId_fkey"
FOREIGN KEY ("sellerProfileId") REFERENCES "SellerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SellerStoreRevision" ADD CONSTRAINT "SellerStoreRevision_reviewerId_fkey"
FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
