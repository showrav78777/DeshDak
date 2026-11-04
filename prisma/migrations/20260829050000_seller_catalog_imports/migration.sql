CREATE TYPE "SellerCatalogImportStatus" AS ENUM ('PREVIEW_READY', 'COMPLETED', 'CANCELLED', 'EXPIRED');
CREATE TYPE "SellerCatalogImportRowStatus" AS ENUM ('VALID', 'INVALID', 'IMPORTED');

CREATE TABLE "SellerCatalogImport" (
    "id" TEXT NOT NULL,
    "sellerProfileId" TEXT NOT NULL,
    "status" "SellerCatalogImportStatus" NOT NULL DEFAULT 'PREVIEW_READY',
    "originalFilename" TEXT,
    "fingerprint" TEXT NOT NULL,
    "mapping" JSONB NOT NULL,
    "totalRows" INTEGER NOT NULL,
    "validRows" INTEGER NOT NULL,
    "invalidRows" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SellerCatalogImport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SellerCatalogImportRow" (
    "id" TEXT NOT NULL,
    "catalogImportId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "status" "SellerCatalogImportRowStatus" NOT NULL,
    "sourceData" JSONB NOT NULL,
    "normalizedData" JSONB,
    "validationErrors" JSONB NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "productId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SellerCatalogImportRow_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SellerCatalogImport_sellerProfileId_status_createdAt_idx" ON "SellerCatalogImport"("sellerProfileId", "status", "createdAt");
CREATE INDEX "SellerCatalogImport_sellerProfileId_fingerprint_idx" ON "SellerCatalogImport"("sellerProfileId", "fingerprint");
CREATE UNIQUE INDEX "SellerCatalogImport_completed_fingerprint_key" ON "SellerCatalogImport"("sellerProfileId", "fingerprint") WHERE "status" = 'COMPLETED';
CREATE UNIQUE INDEX "SellerCatalogImportRow_productId_key" ON "SellerCatalogImportRow"("productId");
CREATE UNIQUE INDEX "SellerCatalogImportRow_catalogImportId_rowNumber_key" ON "SellerCatalogImportRow"("catalogImportId", "rowNumber");
CREATE INDEX "SellerCatalogImportRow_catalogImportId_status_rowNumber_idx" ON "SellerCatalogImportRow"("catalogImportId", "status", "rowNumber");

ALTER TABLE "SellerCatalogImport" ADD CONSTRAINT "SellerCatalogImport_sellerProfileId_fkey" FOREIGN KEY ("sellerProfileId") REFERENCES "SellerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SellerCatalogImportRow" ADD CONSTRAINT "SellerCatalogImportRow_catalogImportId_fkey" FOREIGN KEY ("catalogImportId") REFERENCES "SellerCatalogImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SellerCatalogImportRow" ADD CONSTRAINT "SellerCatalogImportRow_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SellerCatalogImport" ADD CONSTRAINT "SellerCatalogImport_counts_check" CHECK ("totalRows" > 0 AND "validRows" >= 0 AND "invalidRows" >= 0 AND "validRows" + "invalidRows" = "totalRows");
ALTER TABLE "SellerCatalogImportRow" ADD CONSTRAINT "SellerCatalogImportRow_rowNumber_check" CHECK ("rowNumber" >= 2);
