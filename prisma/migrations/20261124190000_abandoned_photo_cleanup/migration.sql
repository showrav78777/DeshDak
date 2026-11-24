CREATE TABLE "PrivateMediaCleanupAttempt" (
 "id" TEXT PRIMARY KEY,
 "requestId" TEXT NOT NULL UNIQUE REFERENCES "PrivateMediaDeletionRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "uploadId" TEXT NOT NULL UNIQUE REFERENCES "PrivatePhotoUpload"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "actorId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "idempotencyKey" VARCHAR(36) NOT NULL,
 "storageNamespace" VARCHAR(64) NOT NULL CHECK ("storageNamespace" ~ '^[a-f0-9]{64}$'),
 "referenceSnapshot" JSONB NOT NULL CHECK (jsonb_typeof("referenceSnapshot")='object'),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "deadlineAt" TIMESTAMP(3) NOT NULL CHECK ("deadlineAt">"createdAt")
);
CREATE UNIQUE INDEX "PrivateMediaCleanupAttempt_actorId_idempotencyKey_key" ON "PrivateMediaCleanupAttempt"("actorId","idempotencyKey");
CREATE INDEX "PrivateMediaCleanupAttempt_createdAt_id_idx" ON "PrivateMediaCleanupAttempt"("createdAt","id");
CREATE TABLE "PrivateMediaCleanupObservation" (
 "id" TEXT PRIMARY KEY,
 "attemptId" TEXT NOT NULL REFERENCES "PrivateMediaCleanupAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "actorId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "idempotencyKey" VARCHAR(36) NOT NULL,
 "sequence" INTEGER NOT NULL CHECK ("sequence" BETWEEN 1 AND 10),
 "kind" VARCHAR(16) NOT NULL CHECK ("kind" IN ('EXECUTE','RECONCILE')),
 "state" VARCHAR(16) NOT NULL CHECK ("state" IN ('BLOCKED','UNCERTAIN','VERSION_ABSENT')),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "PrivateMediaCleanupObservation_actorId_idempotencyKey_key" ON "PrivateMediaCleanupObservation"("actorId","idempotencyKey");
CREATE UNIQUE INDEX "PrivateMediaCleanupObservation_attemptId_sequence_key" ON "PrivateMediaCleanupObservation"("attemptId","sequence");
CREATE FUNCTION private_media_cleanup_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE request_actor TEXT; request_upload TEXT; last_sequence INTEGER; last_state TEXT; item "PrivatePhotoUpload";
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Cleanup journal is immutable'; END IF;
 PERFORM pg_advisory_xact_lock(191119,1);
 NEW."createdAt" := clock_timestamp();
 IF (SELECT COUNT(*) FROM "UserRole" ur JOIN "Role" r ON r."id"=ur."roleId" WHERE ur."userId"=NEW."actorId" AND r."code" IN ('admin','compliance'))<>2 THEN RAISE EXCEPTION 'Admin and Compliance execution authority required'; END IF;
 IF TG_TABLE_NAME='PrivateMediaCleanupAttempt' THEN
  SELECT r."actorId",r."uploadId" INTO request_actor,request_upload FROM "PrivateMediaDeletionRequest" r JOIN "PrivateMediaDeletionDecision" d ON d."requestId"=r."id" WHERE r."id"=NEW."requestId" AND d."decision"='APPROVED' AND r."expiresAt">NEW."createdAt";
  IF request_actor IS NULL OR request_actor=NEW."actorId" OR request_upload<>NEW."uploadId" THEN RAISE EXCEPTION 'Current independent approved review required'; END IF;
  SELECT * INTO item FROM "PrivatePhotoUpload" WHERE "id"=NEW."uploadId" FOR UPDATE;
  IF item."status"<>'STORED' OR item."purpose"<>'identity' OR item."submissionScope" IS NOT NULL OR item."storageNamespace"<>NEW."storageNamespace" OR item."storedReference" IS DISTINCT FROM NEW."referenceSnapshot" OR EXISTS (SELECT 1 FROM "PrivatePhotoLink" WHERE "uploadId"=item."id") THEN RAISE EXCEPTION 'Unbound stored identity upload required'; END IF;
  NEW."deadlineAt" := NEW."createdAt" + INTERVAL '120 seconds';
 ELSE
  SELECT r."actorId" INTO request_actor FROM "PrivateMediaCleanupAttempt" a JOIN "PrivateMediaDeletionRequest" r ON r."id"=a."requestId" WHERE a."id"=NEW."attemptId";
  IF request_actor IS NULL OR request_actor=NEW."actorId" THEN RAISE EXCEPTION 'Independent cleanup reconciliation required'; END IF;
  SELECT o."sequence",o."state" INTO last_sequence,last_state FROM "PrivateMediaCleanupObservation" o WHERE o."attemptId"=NEW."attemptId" ORDER BY o."sequence" DESC LIMIT 1;
  IF last_state='VERSION_ABSENT' OR NEW."sequence"<>COALESCE(last_sequence,0)+1 THEN RAISE EXCEPTION 'Cleanup observation conflict'; END IF;
  IF NEW."kind"='EXECUTE' AND (NEW."sequence"<>1 OR NEW."actorId"<>(SELECT "actorId" FROM "PrivateMediaCleanupAttempt" WHERE "id"=NEW."attemptId")) THEN RAISE EXCEPTION 'Only the first authorized attempt may dispatch deletion'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "PrivateMediaCleanupAttempt_integrity" BEFORE INSERT OR UPDATE OR DELETE ON "PrivateMediaCleanupAttempt" FOR EACH ROW EXECUTE FUNCTION private_media_cleanup_integrity();
CREATE TRIGGER "PrivateMediaCleanupObservation_integrity" BEFORE INSERT OR UPDATE OR DELETE ON "PrivateMediaCleanupObservation" FOR EACH ROW EXECUTE FUNCTION private_media_cleanup_integrity();
ALTER TABLE "PrivatePhotoUpload" DROP CONSTRAINT "PrivatePhotoUpload_status_check";
ALTER TABLE "PrivatePhotoUpload" ADD CONSTRAINT "PrivatePhotoUpload_status_check" CHECK ("status" IN ('PREPARED','STORED','REVIEW_REQUIRED','REMOVED'));
ALTER TABLE "PrivatePhotoUpload" ADD CONSTRAINT "PrivatePhotoUpload_removed_check" CHECK ("status"<>'REMOVED' OR ("storedReference" IS NULL AND "encryptedBody" IS NULL AND "submissionScope" IS NULL AND "originalScanSha256" IS NULL AND "originalScanVerifiedAt" IS NULL AND "scanVerifiedSha256" IS NULL AND "scanVerifiedAt" IS NULL AND "leaseToken" IS NULL AND "leaseExpiresAt" IS NULL AND "preparedReference"='{}'::jsonb));
CREATE FUNCTION private_media_cleanup_fence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='PrivatePhotoLink' THEN
  IF EXISTS (SELECT 1 FROM "PrivateMediaCleanupAttempt" WHERE "uploadId"=NEW."uploadId") THEN RAISE EXCEPTION 'Cleanup-fenced upload cannot be linked'; END IF;
 ELSIF OLD."status"='REMOVED' THEN RAISE EXCEPTION 'Removed upload tombstone is immutable';
 ELSIF NEW."status"='REMOVED' THEN
  IF OLD."status"<>'STORED' OR EXISTS (SELECT 1 FROM "PrivatePhotoLink" WHERE "uploadId"=NEW."id") OR NOT EXISTS (SELECT 1 FROM "PrivateMediaCleanupAttempt" a JOIN "PrivateMediaCleanupObservation" o ON o."attemptId"=a."id" WHERE a."uploadId"=NEW."id" AND o."state"='VERSION_ABSENT') THEN RAISE EXCEPTION 'Confirmed journalled version absence required'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "PrivateMediaCleanup_link_fence" BEFORE INSERT OR UPDATE ON "PrivatePhotoLink" FOR EACH ROW EXECUTE FUNCTION private_media_cleanup_fence();
CREATE TRIGGER "PrivateMediaCleanup_tombstone" BEFORE UPDATE ON "PrivatePhotoUpload" FOR EACH ROW EXECUTE FUNCTION private_media_cleanup_fence();
