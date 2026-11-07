ALTER TABLE "PrivatePhotoUpload" ADD COLUMN "originalScanSha256" VARCHAR(64), ADD COLUMN "originalScanVerifiedAt" TIMESTAMP(3);
ALTER TABLE "PrivatePhotoUpload" ADD CONSTRAINT "PrivatePhotoUpload_original_scan_pair_check" CHECK (("originalScanSha256" IS NULL) = ("originalScanVerifiedAt" IS NULL));
CREATE OR REPLACE FUNCTION enforce_private_photo_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item "PrivatePhotoUpload"; subject_actor TEXT; subject_sha TEXT; subject_mime TEXT; subject_size INTEGER;
BEGIN
 IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'Private photo bindings are immutable'; END IF;
 SELECT * INTO item FROM "PrivatePhotoUpload" WHERE "id" = NEW."uploadId" FOR UPDATE;
 IF item."status" <> 'STORED' OR item."actorId" <> NEW."linkedById" OR item."scanVerifiedAt" IS NULL OR item."scanVerifiedSha256" IS DISTINCT FROM item."storedReference"->>'plaintextSha256' THEN
  RAISE EXCEPTION 'Stored and scan-verified photo required';
 END IF;
 IF item."originalScanVerifiedAt" IS NULL OR item."originalScanSha256" IS NULL OR item."originalScanSha256" !~ '^[a-f0-9]{64}$' OR item."originalScanVerifiedAt" > item."scanVerifiedAt" OR item."scanVerifiedAt" < item."createdAt" OR item."scanVerifiedAt" > CURRENT_TIMESTAMP + INTERVAL '5 minutes' THEN
  RAISE EXCEPTION 'Original and normalized scan attestations required';
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
