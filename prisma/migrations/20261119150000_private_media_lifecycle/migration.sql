CREATE TABLE "PrivateMediaPolicy" (
 "id" TEXT PRIMARY KEY, "sequence" INTEGER NOT NULL UNIQUE,
 "identityDays" INTEGER NOT NULL CHECK ("identityDays" BETWEEN 1 AND 36500),
 "inspectionDays" INTEGER NOT NULL CHECK ("inspectionDays" BETWEEN 1 AND 36500),
 "abandonedHours" INTEGER NOT NULL CHECK ("abandonedHours" BETWEEN 24 AND 8760),
 "caseReference" VARCHAR(80) NOT NULL CHECK (char_length("caseReference") BETWEEN 8 AND 80 AND "caseReference" ~ '^(INC|SEC|KYC|OPS)-[A-Z0-9]+(-[A-Z0-9]+){0,5}$'),
 "actorId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "idempotencyKey" VARCHAR(36) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "PrivateMediaPolicy_actorId_idempotencyKey_key" ON "PrivateMediaPolicy"("actorId","idempotencyKey");
CREATE TABLE "PrivateMediaHold" (
 "id" TEXT PRIMARY KEY,
 "uploadId" TEXT REFERENCES "PrivatePhotoUpload"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "accountId" TEXT REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "orderId" TEXT REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "packageId" TEXT REFERENCES "Package"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "actorId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "caseReference" VARCHAR(80) NOT NULL CHECK (char_length("caseReference") BETWEEN 8 AND 80 AND "caseReference" ~ '^(INC|SEC|KYC|OPS)-[A-Z0-9]+(-[A-Z0-9]+){0,5}$'),
 "idempotencyKey" VARCHAR(36) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "PrivateMediaHold_one_target" CHECK (num_nonnulls("uploadId","accountId","orderId","packageId") = 1)
);
CREATE UNIQUE INDEX "PrivateMediaHold_actorId_idempotencyKey_key" ON "PrivateMediaHold"("actorId","idempotencyKey");
CREATE INDEX "PrivateMediaHold_uploadId_idx" ON "PrivateMediaHold"("uploadId");
CREATE INDEX "PrivateMediaHold_accountId_idx" ON "PrivateMediaHold"("accountId");
CREATE INDEX "PrivateMediaHold_orderId_idx" ON "PrivateMediaHold"("orderId");
CREATE INDEX "PrivateMediaHold_packageId_idx" ON "PrivateMediaHold"("packageId");
CREATE INDEX "PrivateMediaHold_createdAt_id_idx" ON "PrivateMediaHold"("createdAt","id");
CREATE TABLE "PrivateMediaHoldRelease" (
 "id" TEXT PRIMARY KEY, "holdId" TEXT NOT NULL UNIQUE REFERENCES "PrivateMediaHold"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "actorId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "caseReference" VARCHAR(80) NOT NULL CHECK (char_length("caseReference") BETWEEN 8 AND 80 AND "caseReference" ~ '^(INC|SEC|KYC|OPS)-[A-Z0-9]+(-[A-Z0-9]+){0,5}$'),
 "idempotencyKey" VARCHAR(36) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "PrivateMediaHoldRelease_actorId_idempotencyKey_key" ON "PrivateMediaHoldRelease"("actorId","idempotencyKey");
CREATE FUNCTION private_media_lifecycle_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous_sequence INTEGER; requester TEXT;
BEGIN
 IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Private media lifecycle records are immutable'; END IF;
 PERFORM pg_advisory_xact_lock(191119, 1);
 IF TG_TABLE_NAME = 'PrivateMediaPolicy' THEN
  SELECT COALESCE(MAX("sequence"),0) INTO previous_sequence FROM "PrivateMediaPolicy";
  IF NEW."sequence" <> previous_sequence + 1 THEN RAISE EXCEPTION 'Media policy version conflict'; END IF;
 ELSIF TG_TABLE_NAME = 'PrivateMediaHoldRelease' THEN
  SELECT "actorId" INTO requester FROM "PrivateMediaHold" WHERE "id" = NEW."holdId" FOR UPDATE;
  IF requester IS NULL OR requester = NEW."actorId" THEN RAISE EXCEPTION 'Independent hold release required'; END IF;
  IF (SELECT COUNT(*) FROM "UserRole" ur JOIN "Role" r ON r."id"=ur."roleId" WHERE ur."userId"=NEW."actorId" AND r."code" IN ('admin','compliance')) <> 2 THEN RAISE EXCEPTION 'Admin and Compliance release required'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "PrivateMediaPolicy_integrity" BEFORE INSERT OR UPDATE OR DELETE ON "PrivateMediaPolicy" FOR EACH ROW EXECUTE FUNCTION private_media_lifecycle_integrity();
CREATE TRIGGER "PrivateMediaHold_integrity" BEFORE INSERT OR UPDATE OR DELETE ON "PrivateMediaHold" FOR EACH ROW EXECUTE FUNCTION private_media_lifecycle_integrity();
CREATE TRIGGER "PrivateMediaHoldRelease_integrity" BEFORE INSERT OR UPDATE OR DELETE ON "PrivateMediaHoldRelease" FOR EACH ROW EXECUTE FUNCTION private_media_lifecycle_integrity();
