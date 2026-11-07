ALTER TABLE "PrivatePhotoUpload" ADD COLUMN "scanVerifiedSha256" VARCHAR(64), ADD COLUMN "scanVerifiedAt" TIMESTAMP(3);
ALTER TABLE "PrivatePhotoUpload" ADD CONSTRAINT "PrivatePhotoUpload_scan_pair_check" CHECK (("scanVerifiedSha256" IS NULL) = ("scanVerifiedAt" IS NULL));
CREATE TABLE "PrivatePhotoLink" (
 "id" TEXT NOT NULL, "uploadId" TEXT NOT NULL, "identityVerificationId" TEXT,
 "inspectionEvidenceId" TEXT, "linkedById" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "PrivatePhotoLink_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "PrivatePhotoLink_one_subject_check" CHECK (("identityVerificationId" IS NOT NULL)::int + ("inspectionEvidenceId" IS NOT NULL)::int = 1)
);
CREATE UNIQUE INDEX "PrivatePhotoLink_uploadId_key" ON "PrivatePhotoLink"("uploadId");
CREATE UNIQUE INDEX "PrivatePhotoLink_identityVerificationId_key" ON "PrivatePhotoLink"("identityVerificationId");
CREATE UNIQUE INDEX "PrivatePhotoLink_inspectionEvidenceId_key" ON "PrivatePhotoLink"("inspectionEvidenceId");
CREATE INDEX "PrivatePhotoLink_linkedById_createdAt_idx" ON "PrivatePhotoLink"("linkedById","createdAt");
ALTER TABLE "PrivatePhotoLink" ADD CONSTRAINT "PrivatePhotoLink_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "PrivatePhotoUpload"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrivatePhotoLink" ADD CONSTRAINT "PrivatePhotoLink_identityVerificationId_fkey" FOREIGN KEY ("identityVerificationId") REFERENCES "IdentityVerification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrivatePhotoLink" ADD CONSTRAINT "PrivatePhotoLink_inspectionEvidenceId_fkey" FOREIGN KEY ("inspectionEvidenceId") REFERENCES "InspectionEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrivatePhotoLink" ADD CONSTRAINT "PrivatePhotoLink_linkedById_fkey" FOREIGN KEY ("linkedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE FUNCTION enforce_private_photo_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item "PrivatePhotoUpload"; subject_actor TEXT; subject_sha TEXT; subject_mime TEXT; subject_size INTEGER;
BEGIN
 IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'Private photo bindings are immutable'; END IF;
 SELECT * INTO item FROM "PrivatePhotoUpload" WHERE "id" = NEW."uploadId" FOR UPDATE;
 IF item."status" <> 'STORED' OR item."actorId" <> NEW."linkedById" OR item."scanVerifiedAt" IS NULL OR item."scanVerifiedSha256" IS DISTINCT FROM item."storedReference"->>'plaintextSha256' THEN
  RAISE EXCEPTION 'Stored and scan-verified photo required';
 END IF;
 IF NEW."identityVerificationId" IS NOT NULL THEN
  IF item."purpose" <> 'identity' THEN RAISE EXCEPTION 'Photo purpose mismatch'; END IF;
  SELECT "userId","documentPhotoSha256","documentPhotoMimeType","documentPhotoSizeBytes" INTO subject_actor,subject_sha,subject_mime,subject_size FROM "IdentityVerification" WHERE "id" = NEW."identityVerificationId";
 ELSE
  IF item."purpose" <> 'inspection' THEN RAISE EXCEPTION 'Photo purpose mismatch'; END IF;
  SELECT "uploadedById","sha256","mimeType","sizeBytes" INTO subject_actor,subject_sha,subject_mime,subject_size FROM "InspectionEvidence" WHERE "id" = NEW."inspectionEvidenceId" AND "mediaKind"='PHOTO';
 END IF;
 IF subject_actor IS DISTINCT FROM item."actorId" OR subject_sha IS DISTINCT FROM item."scanVerifiedSha256" OR subject_mime IS DISTINCT FROM item."storedReference"->>'mimeType' OR subject_size IS DISTINCT FROM (item."storedReference"->>'sizeBytes')::int THEN
  RAISE EXCEPTION 'Photo subject metadata mismatch';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "PrivatePhotoLink_integrity" BEFORE INSERT OR UPDATE ON "PrivatePhotoLink" FOR EACH ROW EXECUTE FUNCTION enforce_private_photo_binding();
