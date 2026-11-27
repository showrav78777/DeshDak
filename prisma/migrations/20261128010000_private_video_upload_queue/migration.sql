CREATE TABLE "PrivateVideoUpload" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "actorId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "packageId" TEXT NOT NULL REFERENCES "Package"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "requestKey" VARCHAR(128) NOT NULL,
 "keyScope" VARCHAR(64) NOT NULL,
 "originalSha256" VARCHAR(64) NOT NULL,
 "sizeBytes" INTEGER NOT NULL,
 "encryptedBody" BYTEA NOT NULL,
 "iv" BYTEA NOT NULL,
 "sessionId" TEXT NOT NULL,
 "status" VARCHAR(24) NOT NULL DEFAULT 'QUEUED',
 "attempts" INTEGER NOT NULL DEFAULT 0,
 "leaseToken" VARCHAR(36),
 "leaseExpiresAt" TIMESTAMP(3),
 "storedJobId" TEXT REFERENCES "PrivateVideoJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "PrivateVideoUpload_stored_job" CHECK ("status" <> 'STORED' OR "storedJobId" IS NOT NULL),
 CONSTRAINT "PrivateVideoUpload_bounds" CHECK ("sizeBytes" BETWEEN 16 AND 31457280 AND octet_length("encryptedBody") = "sizeBytes" + 16 AND octet_length("iv") = 12 AND "attempts" BETWEEN 0 AND 5),
 CONSTRAINT "PrivateVideoUpload_state" CHECK (
   ("status" = 'PROCESSING' AND "leaseToken" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL) OR
   ("status" IN ('QUEUED','STORED','REVIEW_REQUIRED','CANCELLED') AND "leaseToken" IS NULL AND "leaseExpiresAt" IS NULL)
 )
);
CREATE UNIQUE INDEX "PrivateVideoUpload_actorId_requestKey_key" ON "PrivateVideoUpload"("actorId","requestKey");
CREATE INDEX "PrivateVideoUpload_status_leaseExpiresAt_idx" ON "PrivateVideoUpload"("status","leaseExpiresAt");
CREATE FUNCTION private_video_upload_identity_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW."id",NEW."actorId",NEW."packageId",NEW."requestKey",NEW."keyScope",NEW."originalSha256",NEW."sizeBytes",NEW."encryptedBody",NEW."iv",NEW."createdAt") IS DISTINCT FROM
    ROW(OLD."id",OLD."actorId",OLD."packageId",OLD."requestKey",OLD."keyScope",OLD."originalSha256",OLD."sizeBytes",OLD."encryptedBody",OLD."iv",OLD."createdAt") THEN
   RAISE EXCEPTION 'Video upload identity and encrypted source are immutable';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER "PrivateVideoUpload_identity_immutable" BEFORE UPDATE ON "PrivateVideoUpload"
FOR EACH ROW EXECUTE FUNCTION private_video_upload_identity_immutable();
