CREATE TABLE "PrivatePhotoRescan" (
 "id" TEXT NOT NULL, "uploadId" TEXT NOT NULL, "quarantineId" TEXT NOT NULL, "reviewId" TEXT NOT NULL,
 "actorId" TEXT NOT NULL, "idempotencyKey" VARCHAR(36) NOT NULL, "storageNamespace" VARCHAR(64) NOT NULL,
 "referenceSnapshot" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "deadlineAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "PrivatePhotoRescan_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "PrivatePhotoRescan_reference_check" CHECK (jsonb_typeof("referenceSnapshot") = 'object'),
 CONSTRAINT "PrivatePhotoRescan_deadline_check" CHECK ("deadlineAt" > "createdAt" AND "deadlineAt" <= "createdAt" + INTERVAL '90 seconds')
);
CREATE UNIQUE INDEX "PrivatePhotoRescan_reviewId_key" ON "PrivatePhotoRescan"("reviewId");
CREATE UNIQUE INDEX "PrivatePhotoRescan_actorId_idempotencyKey_key" ON "PrivatePhotoRescan"("actorId","idempotencyKey");
CREATE INDEX "PrivatePhotoRescan_uploadId_createdAt_idx" ON "PrivatePhotoRescan"("uploadId","createdAt");
ALTER TABLE "PrivatePhotoRescan" ADD CONSTRAINT "PrivatePhotoRescan_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "PrivatePhotoUpload"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrivatePhotoRescan" ADD CONSTRAINT "PrivatePhotoRescan_quarantineId_fkey" FOREIGN KEY ("quarantineId") REFERENCES "PrivatePhotoQuarantine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrivatePhotoRescan" ADD CONSTRAINT "PrivatePhotoRescan_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "PrivatePhotoQuarantineReview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrivatePhotoRescan" ADD CONSTRAINT "PrivatePhotoRescan_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TABLE "PrivatePhotoRescanResult" (
 "id" TEXT NOT NULL, "rescanId" TEXT NOT NULL, "state" VARCHAR(16) NOT NULL, "sha256" VARCHAR(64), "verifiedAt" TIMESTAMP(3), "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "PrivatePhotoRescanResult_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "PrivatePhotoRescanResult_state_check" CHECK ("state" IN ('CLEAN','UNCONFIRMED')),
 CONSTRAINT "PrivatePhotoRescanResult_proof_check" CHECK (("state" = 'CLEAN' AND "sha256" ~ '^[a-f0-9]{64}$' AND "sha256" IS NOT NULL AND "verifiedAt" IS NOT NULL) OR ("state" = 'UNCONFIRMED' AND "sha256" IS NULL AND "verifiedAt" IS NULL))
);
CREATE UNIQUE INDEX "PrivatePhotoRescanResult_rescanId_key" ON "PrivatePhotoRescanResult"("rescanId");
ALTER TABLE "PrivatePhotoRescanResult" ADD CONSTRAINT "PrivatePhotoRescanResult_rescanId_fkey" FOREIGN KEY ("rescanId") REFERENCES "PrivatePhotoRescan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE FUNCTION enforce_private_photo_rescan() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item "PrivatePhotoUpload"; latest "PrivatePhotoQuarantineReview";
BEGIN
 IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Rescan requests are immutable'; END IF;
 SELECT * INTO item FROM "PrivatePhotoUpload" WHERE "id" = NEW."uploadId" FOR UPDATE;
 IF NOT EXISTS (SELECT 1 FROM "PrivatePhotoQuarantine" WHERE "id" = NEW."quarantineId" AND "uploadId" = NEW."uploadId") THEN RAISE EXCEPTION 'Quarantined photo required'; END IF;
 SELECT * INTO latest FROM "PrivatePhotoQuarantineReview" WHERE "quarantineId" = NEW."quarantineId" ORDER BY "sequence" DESC LIMIT 1;
 IF latest."id" IS DISTINCT FROM NEW."reviewId" OR latest."decision" IS DISTINCT FROM 'RESCAN_REQUIRED' THEN RAISE EXCEPTION 'Current rescan review required'; END IF;
 IF item."status" <> 'STORED' OR item."storageNamespace" <> NEW."storageNamespace" OR item."storedReference" IS DISTINCT FROM NEW."referenceSnapshot" THEN RAISE EXCEPTION 'Confirmed stored photo required'; END IF;
 IF EXISTS (SELECT 1 FROM "PrivatePhotoRescan" r WHERE r."uploadId" = NEW."uploadId" AND r."deadlineAt" > statement_timestamp() AND NOT EXISTS (SELECT 1 FROM "PrivatePhotoRescanResult" x WHERE x."rescanId" = r."id")) THEN RAISE EXCEPTION 'Rescan already pending'; END IF;
 IF (SELECT COUNT(*) FROM "PrivatePhotoRescan" WHERE "uploadId" = NEW."uploadId" AND "createdAt" > statement_timestamp() - INTERVAL '24 hours') >= 5 THEN RAISE EXCEPTION 'Rescan limit reached'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "PrivatePhotoRescan_integrity" BEFORE INSERT OR UPDATE OR DELETE ON "PrivatePhotoRescan" FOR EACH ROW EXECUTE FUNCTION enforce_private_photo_rescan();
CREATE FUNCTION enforce_private_photo_rescan_result() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE request "PrivatePhotoRescan"; item "PrivatePhotoUpload"; latest_id TEXT;
BEGIN
 IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Rescan results are immutable'; END IF;
 SELECT * INTO request FROM "PrivatePhotoRescan" WHERE "id" = NEW."rescanId";
 SELECT * INTO item FROM "PrivatePhotoUpload" WHERE "id" = request."uploadId" FOR UPDATE;
 IF NEW."state" = 'CLEAN' THEN
  SELECT "id" INTO latest_id FROM "PrivatePhotoQuarantineReview" WHERE "quarantineId" = request."quarantineId" ORDER BY "sequence" DESC LIMIT 1;
  IF request."deadlineAt" <= statement_timestamp() OR latest_id IS DISTINCT FROM request."reviewId" OR item."status" <> 'STORED' OR item."storageNamespace" <> request."storageNamespace" OR item."storedReference" IS DISTINCT FROM request."referenceSnapshot" OR NEW."sha256" IS DISTINCT FROM request."referenceSnapshot"->>'plaintextSha256' OR NEW."verifiedAt" < request."createdAt" OR NEW."verifiedAt" > statement_timestamp() + INTERVAL '5 seconds' THEN RAISE EXCEPTION 'Fresh unchanged scan context required'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "PrivatePhotoRescanResult_integrity" BEFORE INSERT OR UPDATE OR DELETE ON "PrivatePhotoRescanResult" FOR EACH ROW EXECUTE FUNCTION enforce_private_photo_rescan_result();
