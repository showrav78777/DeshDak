-- Private, encrypted warehouse and inspector evidence. Public object URLs are
-- intentionally not stored here: production uploads require the separately
-- configured object-storage and malware-scanning pipeline.
CREATE TABLE "InspectionEvidence" (
  "id" TEXT NOT NULL,
  "packageId" TEXT NOT NULL,
  "uploadedById" TEXT NOT NULL,
  "mediaKind" TEXT NOT NULL,
  "mimeType" VARCHAR(64) NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "sha256" VARCHAR(64) NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "iv" VARCHAR(32) NOT NULL,
  "authTag" VARCHAR(32) NOT NULL,
  "originalName" VARCHAR(180),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InspectionEvidence_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "InspectionEvidence"
  ADD CONSTRAINT "InspectionEvidence_packageId_fkey"
  FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InspectionEvidence"
  ADD CONSTRAINT "InspectionEvidence_uploadedById_fkey"
  FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "InspectionEvidence_packageId_createdAt_idx" ON "InspectionEvidence"("packageId", "createdAt");
CREATE INDEX "InspectionEvidence_uploadedById_createdAt_idx" ON "InspectionEvidence"("uploadedById", "createdAt");
