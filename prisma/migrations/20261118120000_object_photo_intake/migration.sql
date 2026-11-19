ALTER TABLE "InspectionEvidence"
  ALTER COLUMN "ciphertext" DROP NOT NULL,
  ALTER COLUMN "iv" DROP NOT NULL,
  ALTER COLUMN "authTag" DROP NOT NULL;
ALTER TABLE "InspectionEvidence" ADD CONSTRAINT "InspectionEvidence_ciphertext_pair"
CHECK (("ciphertext" IS NULL AND "iv" IS NULL AND "authTag" IS NULL AND "mediaKind" = 'PHOTO')
    OR ("ciphertext" IS NOT NULL AND "iv" IS NOT NULL AND "authTag" IS NOT NULL));

ALTER TABLE "PrivatePhotoUpload" ADD COLUMN "submissionScope" JSONB;
