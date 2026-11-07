CREATE TABLE "PrivatePhotoQuarantine" (
 "id" TEXT NOT NULL, "uploadId" TEXT NOT NULL, "actorId" TEXT NOT NULL,
 "idempotencyKey" VARCHAR(36) NOT NULL, "reason" VARCHAR(32) NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "PrivatePhotoQuarantine_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "PrivatePhotoQuarantine_reason_check" CHECK ("reason" IN ('SUSPECTED_MALWARE','PRIVACY_REVIEW','INTEGRITY_FAILURE'))
);
CREATE UNIQUE INDEX "PrivatePhotoQuarantine_uploadId_key" ON "PrivatePhotoQuarantine"("uploadId");
CREATE UNIQUE INDEX "PrivatePhotoQuarantine_actorId_idempotencyKey_key" ON "PrivatePhotoQuarantine"("actorId","idempotencyKey");
CREATE INDEX "PrivatePhotoQuarantine_createdAt_id_idx" ON "PrivatePhotoQuarantine"("createdAt","id");
ALTER TABLE "PrivatePhotoQuarantine" ADD CONSTRAINT "PrivatePhotoQuarantine_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "PrivatePhotoUpload"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrivatePhotoQuarantine" ADD CONSTRAINT "PrivatePhotoQuarantine_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE FUNCTION enforce_private_photo_quarantine() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Photo quarantine is immutable'; END IF;
 PERFORM "id" FROM "PrivatePhotoUpload" WHERE "id" = NEW."uploadId" FOR UPDATE;
 RETURN NEW;
END $$;
CREATE TRIGGER "PrivatePhotoQuarantine_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "PrivatePhotoQuarantine" FOR EACH ROW EXECUTE FUNCTION enforce_private_photo_quarantine();
CREATE FUNCTION block_quarantined_photo_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_upload TEXT;
BEGIN
 target_upload := CASE WHEN TG_OP = 'DELETE' THEN OLD."uploadId" ELSE NEW."uploadId" END;
 PERFORM "id" FROM "PrivatePhotoUpload" WHERE "id" = target_upload FOR UPDATE;
 IF EXISTS (SELECT 1 FROM "PrivatePhotoQuarantine" WHERE "uploadId" = target_upload) THEN RAISE EXCEPTION 'Quarantined photo binding cannot be added or removed'; END IF;
 IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "PrivatePhotoLink_quarantine" BEFORE INSERT OR DELETE ON "PrivatePhotoLink" FOR EACH ROW EXECUTE FUNCTION block_quarantined_photo_binding();
