-- No publication state exists until delivery/lifecycle acceptance is complete.
CREATE TABLE "PrivateVideoProcessingProof" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "jobId" TEXT NOT NULL REFERENCES "PrivateVideoJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "sessionId" VARCHAR(36) NOT NULL,
 "manifest" JSONB NOT NULL,
 "manifestSha256" VARCHAR(64) NOT NULL,
 "verifiedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "PrivateVideoProcessingProof_jobId_key" ON "PrivateVideoProcessingProof"("jobId");
CREATE TABLE "PrivateVideoEvidenceLink" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "jobId" TEXT NOT NULL REFERENCES "PrivateVideoJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "evidenceId" TEXT NOT NULL REFERENCES "InspectionEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "processingProofId" TEXT NOT NULL REFERENCES "PrivateVideoProcessingProof"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "linkedById" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "status" VARCHAR(16) NOT NULL DEFAULT 'STAGED',
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "PrivateVideoEvidenceLink_staged_check" CHECK ("status" = 'STAGED')
);
CREATE UNIQUE INDEX "PrivateVideoEvidenceLink_jobId_key" ON "PrivateVideoEvidenceLink"("jobId");
CREATE UNIQUE INDEX "PrivateVideoEvidenceLink_evidenceId_key" ON "PrivateVideoEvidenceLink"("evidenceId");

CREATE UNIQUE INDEX "PrivateVideoEvidenceLink_processingProofId_key" ON "PrivateVideoEvidenceLink"("processingProofId");
ALTER TABLE "InspectionEvidence" DROP CONSTRAINT "InspectionEvidence_ciphertext_pair";
ALTER TABLE "InspectionEvidence" ADD CONSTRAINT "InspectionEvidence_ciphertext_pair"
CHECK (("ciphertext" IS NULL AND "iv" IS NULL AND "authTag" IS NULL AND "mediaKind" IN ('PHOTO','VIDEO'))
    OR ("ciphertext" IS NOT NULL AND "iv" IS NOT NULL AND "authTag" IS NOT NULL));

-- External VIDEO rows must have their complete binding at transaction commit.
-- Deferral permits the evidence and its link to be inserted/deleted atomically.
CREATE FUNCTION enforce_private_video_evidence_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target TEXT; targets TEXT[];
BEGIN
 IF TG_TABLE_NAME = 'InspectionEvidence' THEN
   targets := ARRAY[NEW."id"];
 ELSIF TG_OP = 'DELETE' THEN
   targets := ARRAY[OLD."evidenceId"];
 ELSIF TG_OP = 'UPDATE' THEN
   targets := ARRAY[OLD."evidenceId", NEW."evidenceId"];
 ELSE
   targets := ARRAY[NEW."evidenceId"];
 END IF;
 FOREACH target IN ARRAY targets LOOP
 IF EXISTS (
   SELECT 1 FROM "InspectionEvidence" e
   WHERE e."id" = target AND e."mediaKind" = 'VIDEO' AND e."ciphertext" IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM "PrivateVideoEvidenceLink" l
     JOIN "PrivateVideoJob" j ON j."id" = l."jobId"
     JOIN "PrivateVideoProcessingProof" p ON p."id" = l."processingProofId" AND p."jobId" = j."id"
     WHERE l."evidenceId" = e."id" AND l."status" = 'STAGED' AND j."status" = 'STORED'
       AND j."actorId" = e."uploadedById" AND j."packageId" = e."packageId"
       AND l."linkedById" = e."uploadedById"
   )
 ) THEN
   RAISE EXCEPTION 'External video requires a complete staged binding' USING ERRCODE = '23514';
 END IF;
 END LOOP;
 RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "InspectionEvidence_private_video_binding"
AFTER INSERT OR UPDATE ON "InspectionEvidence" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_private_video_evidence_binding();
CREATE CONSTRAINT TRIGGER "PrivateVideoEvidenceLink_complete_binding"
AFTER INSERT OR UPDATE OR DELETE ON "PrivateVideoEvidenceLink" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_private_video_evidence_binding();
