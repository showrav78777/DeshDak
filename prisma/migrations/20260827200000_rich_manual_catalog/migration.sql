-- Rich, provider-neutral product content for seller-authored and imported catalogs.
CREATE TYPE "ProductMediaKind" AS ENUM ('IMAGE', 'VIDEO', 'DOCUMENT');
CREATE TYPE "ProductMediaStatus" AS ENUM ('PENDING_SCAN', 'READY', 'REJECTED');

ALTER TABLE "Product"
ADD COLUMN "shortDescription" TEXT,
ADD COLUMN "highlights" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "brand" TEXT,
ADD COLUMN "modelNumber" TEXT,
ADD COLUMN "minimumOrderQuantity" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "sampleAvailable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "customizationAvailable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "productionLeadDaysMin" INTEGER,
ADD COLUMN "productionLeadDaysMax" INTEGER,
ADD COLUMN "sellingUnit" TEXT,
ADD COLUMN "packageContents" TEXT,
ADD COLUMN "returnPolicy" TEXT,
ADD COLUMN "warrantyInfo" TEXT,
ADD COLUMN "completenessScore" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Product"
ADD CONSTRAINT "Product_minimumOrderQuantity_check" CHECK ("minimumOrderQuantity" > 0),
ADD CONSTRAINT "Product_completenessScore_check" CHECK ("completenessScore" BETWEEN 0 AND 100),
ADD CONSTRAINT "Product_productionLeadDays_check" CHECK (
  ("productionLeadDaysMin" IS NULL AND "productionLeadDaysMax" IS NULL)
  OR (
    "productionLeadDaysMin" IS NOT NULL
    AND "productionLeadDaysMax" IS NOT NULL
    AND "productionLeadDaysMin" >= 0
    AND "productionLeadDaysMax" >= "productionLeadDaysMin"
  )
);

CREATE TABLE "ProductMedia" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "kind" "ProductMediaKind" NOT NULL,
  "status" "ProductMediaStatus" NOT NULL DEFAULT 'PENDING_SCAN',
  "storageKey" TEXT NOT NULL,
  "originalFilename" TEXT,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "checksumSha256" TEXT NOT NULL,
  "altText" TEXT,
  "caption" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductMedia_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductMedia_sizeBytes_check" CHECK ("sizeBytes" > 0)
);

CREATE UNIQUE INDEX "ProductMedia_storageKey_key" ON "ProductMedia"("storageKey");
CREATE INDEX "ProductMedia_productId_status_sortOrder_idx" ON "ProductMedia"("productId", "status", "sortOrder");
ALTER TABLE "ProductMedia" ADD CONSTRAINT "ProductMedia_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
