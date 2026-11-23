CREATE TABLE "PrivateMediaDeletionRequest" (
 "id" TEXT PRIMARY KEY,
 "uploadId" TEXT NOT NULL REFERENCES "PrivatePhotoUpload"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "policySequence" INTEGER NOT NULL REFERENCES "PrivateMediaPolicy"("sequence") ON DELETE RESTRICT ON UPDATE CASCADE,
 "snapshotDigest" VARCHAR(64) NOT NULL CHECK ("snapshotDigest" ~ '^[a-f0-9]{64}$'),
 "reviewAfter" TIMESTAMP(3) NOT NULL,
 "actorId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "caseReference" VARCHAR(80) NOT NULL CHECK (char_length("caseReference") BETWEEN 8 AND 80 AND "caseReference" ~ '^(INC|SEC|KYC|OPS)-[A-Z0-9]+(-[A-Z0-9]+){0,5}$'),
 "idempotencyKey" VARCHAR(36) NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "expiresAt" TIMESTAMP(3) NOT NULL,
 CHECK ("reviewAfter" <= "createdAt" AND "expiresAt" > "createdAt")
);
CREATE UNIQUE INDEX "PrivateMediaDeletionRequest_actorId_idempotencyKey_key" ON "PrivateMediaDeletionRequest"("actorId","idempotencyKey");
CREATE INDEX "PrivateMediaDeletionRequest_uploadId_idx" ON "PrivateMediaDeletionRequest"("uploadId");
CREATE INDEX "PrivateMediaDeletionRequest_createdAt_id_idx" ON "PrivateMediaDeletionRequest"("createdAt","id");
CREATE TABLE "PrivateMediaDeletionDecision" (
 "id" TEXT PRIMARY KEY,
 "requestId" TEXT NOT NULL UNIQUE REFERENCES "PrivateMediaDeletionRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "actorId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "decision" VARCHAR(8) NOT NULL CHECK ("decision" IN ('APPROVED','REJECTED')),
 "caseReference" VARCHAR(80) NOT NULL CHECK (char_length("caseReference") BETWEEN 8 AND 80 AND "caseReference" ~ '^(INC|SEC|KYC|OPS)-[A-Z0-9]+(-[A-Z0-9]+){0,5}$'),
 "idempotencyKey" VARCHAR(36) NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "PrivateMediaDeletionDecision_actorId_idempotencyKey_key" ON "PrivateMediaDeletionDecision"("actorId","idempotencyKey");
CREATE FUNCTION private_media_deletion_review_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE requester TEXT; deadline TIMESTAMP(3);
BEGIN
 IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Deletion review history is immutable'; END IF;
 PERFORM pg_advisory_xact_lock(191119, 1);
 NEW."createdAt" := clock_timestamp();
 IF TG_TABLE_NAME = 'PrivateMediaDeletionRequest' THEN
  NEW."expiresAt" := NEW."createdAt" + INTERVAL '24 hours';
  IF EXISTS (SELECT 1 FROM "PrivateMediaDeletionRequest" r WHERE r."uploadId"=NEW."uploadId" AND NOT EXISTS (SELECT 1 FROM "PrivateMediaDeletionDecision" d WHERE d."requestId"=r."id")) THEN RAISE EXCEPTION 'Close the pending deletion review first'; END IF;
 ELSE
  SELECT "actorId", "expiresAt" INTO requester, deadline FROM "PrivateMediaDeletionRequest" WHERE "id"=NEW."requestId" FOR UPDATE;
  IF requester IS NULL OR requester=NEW."actorId" THEN RAISE EXCEPTION 'Independent deletion review required'; END IF;
  IF (SELECT COUNT(*) FROM "UserRole" ur JOIN "Role" r ON r."id"=ur."roleId" WHERE ur."userId"=NEW."actorId" AND r."code" IN ('admin','compliance')) <> 2 THEN RAISE EXCEPTION 'Admin and Compliance review required'; END IF;
  IF NEW."decision"='APPROVED' AND deadline <= NEW."createdAt" THEN RAISE EXCEPTION 'Deletion review expired'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "PrivateMediaDeletionRequest_integrity" BEFORE INSERT OR UPDATE OR DELETE ON "PrivateMediaDeletionRequest" FOR EACH ROW EXECUTE FUNCTION private_media_deletion_review_integrity();
CREATE TRIGGER "PrivateMediaDeletionDecision_integrity" BEFORE INSERT OR UPDATE OR DELETE ON "PrivateMediaDeletionDecision" FOR EACH ROW EXECUTE FUNCTION private_media_deletion_review_integrity();
