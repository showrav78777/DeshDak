CREATE TABLE "PrivatePhotoQuarantineReview" (
 "id" TEXT NOT NULL, "quarantineId" TEXT NOT NULL, "actorId" TEXT NOT NULL,
 "idempotencyKey" VARCHAR(36) NOT NULL, "sequence" INTEGER NOT NULL,
 "decision" VARCHAR(32) NOT NULL, "caseReference" VARCHAR(80) NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "PrivatePhotoQuarantineReview_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "PrivatePhotoQuarantineReview_sequence_check" CHECK ("sequence" > 0),
 CONSTRAINT "PrivatePhotoQuarantineReview_decision_check" CHECK ("decision" IN ('KEEP_BLOCKED','RESCAN_REQUIRED','REPLACEMENT_REQUIRED')),
 CONSTRAINT "PrivatePhotoQuarantineReview_reference_check" CHECK (char_length("caseReference") BETWEEN 8 AND 80 AND "caseReference" ~ '^(INC|SEC|KYC|OPS)-[A-Z0-9]+(-[A-Z0-9]+){0,5}$')
);
CREATE UNIQUE INDEX "PrivatePhotoQuarantineReview_actorId_idempotencyKey_key" ON "PrivatePhotoQuarantineReview"("actorId","idempotencyKey");
CREATE UNIQUE INDEX "PrivatePhotoQuarantineReview_quarantineId_sequence_key" ON "PrivatePhotoQuarantineReview"("quarantineId","sequence");
ALTER TABLE "PrivatePhotoQuarantineReview" ADD CONSTRAINT "PrivatePhotoQuarantineReview_quarantineId_fkey" FOREIGN KEY ("quarantineId") REFERENCES "PrivatePhotoQuarantine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrivatePhotoQuarantineReview" ADD CONSTRAINT "PrivatePhotoQuarantineReview_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE FUNCTION enforce_private_photo_quarantine_review() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_upload TEXT; last_sequence INTEGER;
BEGIN
 IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Photo quarantine reviews are immutable'; END IF;
 SELECT "uploadId" INTO target_upload FROM "PrivatePhotoQuarantine" WHERE "id" = NEW."quarantineId";
 PERFORM "id" FROM "PrivatePhotoUpload" WHERE "id" = target_upload FOR UPDATE;
 SELECT COALESCE(MAX("sequence"),0) INTO last_sequence FROM "PrivatePhotoQuarantineReview" WHERE "quarantineId" = NEW."quarantineId";
 IF NEW."sequence" <> last_sequence + 1 THEN RAISE EXCEPTION 'Photo review sequence conflict'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "PrivatePhotoQuarantineReview_integrity" BEFORE INSERT OR UPDATE OR DELETE ON "PrivatePhotoQuarantineReview" FOR EACH ROW EXECUTE FUNCTION enforce_private_photo_quarantine_review();
