CREATE TYPE "SellerCatalogConnectionStatus" AS ENUM ('PENDING_REVIEW', 'CHANGES_REQUESTED', 'CONFIGURATION_SAVED', 'REJECTED', 'REVOKED');
CREATE TYPE "SellerCatalogAuthMethod" AS ENUM ('API_KEY', 'OAUTH2', 'SIGNED_REQUEST', 'CUSTOM_REVIEW');

CREATE TABLE "SellerCatalogConnection" (
    "id" TEXT NOT NULL,
    "sellerProfileId" TEXT NOT NULL,
    "systemName" TEXT NOT NULL,
    "systemKey" TEXT NOT NULL,
    "apiBaseUrl" TEXT NOT NULL,
    "apiDocumentationUrl" TEXT,
    "authMethod" "SellerCatalogAuthMethod" NOT NULL,
    "requestedCapabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expectedProductCount" INTEGER,
    "requestedSyncFrequencyMinutes" INTEGER,
    "sellerNote" TEXT,
    "consentVersion" TEXT NOT NULL,
    "consentGrantedAt" TIMESTAMP(3) NOT NULL,
    "consentRevokedAt" TIMESTAMP(3),
    "status" "SellerCatalogConnectionStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "adapterKey" TEXT,
    "secretReference" TEXT,
    "dataUseApproved" BOOLEAN NOT NULL DEFAULT false,
    "mediaRightsApproved" BOOLEAN NOT NULL DEFAULT false,
    "securityApproved" BOOLEAN NOT NULL DEFAULT false,
    "reviewNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SellerCatalogConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SellerCatalogConnection_sellerProfileId_systemKey_key" ON "SellerCatalogConnection"("sellerProfileId", "systemKey");
CREATE INDEX "SellerCatalogConnection_status_createdAt_idx" ON "SellerCatalogConnection"("status", "createdAt");
CREATE INDEX "SellerCatalogConnection_sellerProfileId_status_createdAt_idx" ON "SellerCatalogConnection"("sellerProfileId", "status", "createdAt");

ALTER TABLE "SellerCatalogConnection" ADD CONSTRAINT "SellerCatalogConnection_sellerProfileId_fkey" FOREIGN KEY ("sellerProfileId") REFERENCES "SellerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SellerCatalogConnection" ADD CONSTRAINT "SellerCatalogConnection_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SellerCatalogConnection" ADD CONSTRAINT "SellerCatalogConnection_expectedProductCount_check" CHECK ("expectedProductCount" IS NULL OR ("expectedProductCount" >= 1 AND "expectedProductCount" <= 1000000));
ALTER TABLE "SellerCatalogConnection" ADD CONSTRAINT "SellerCatalogConnection_sync_frequency_check" CHECK ("requestedSyncFrequencyMinutes" IS NULL OR ("requestedSyncFrequencyMinutes" >= 15 AND "requestedSyncFrequencyMinutes" <= 10080));
ALTER TABLE "SellerCatalogConnection" ADD CONSTRAINT "SellerCatalogConnection_revocation_check" CHECK (("status" = 'REVOKED') = ("consentRevokedAt" IS NOT NULL));
