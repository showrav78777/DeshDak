CREATE TABLE "PrivateVideoQuarantine" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "jobId" TEXT NOT NULL REFERENCES "PrivateVideoJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "actorId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "reason" VARCHAR(32) NOT NULL,
 "caseReference" VARCHAR(80) NOT NULL,
 "idempotencyKey" VARCHAR(36) NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "PrivateVideoQuarantine_reason_check" CHECK ("reason" IN ('SUSPECTED_MALWARE','PRIVACY_REVIEW','INTEGRITY_FAILURE'))
);
CREATE UNIQUE INDEX "PrivateVideoQuarantine_jobId_key" ON "PrivateVideoQuarantine"("jobId");
CREATE UNIQUE INDEX "PrivateVideoQuarantine_actorId_idempotencyKey_key" ON "PrivateVideoQuarantine"("actorId","idempotencyKey");
CREATE INDEX "PrivateVideoQuarantine_createdAt_id_idx" ON "PrivateVideoQuarantine"("createdAt","id");
CREATE FUNCTION reject_private_video_quarantine_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Video quarantine is immutable; preserve the original incident record'; END;
$$;
CREATE TRIGGER "PrivateVideoQuarantine_immutable"
BEFORE UPDATE OR DELETE ON "PrivateVideoQuarantine"
FOR EACH ROW EXECUTE FUNCTION reject_private_video_quarantine_change();
