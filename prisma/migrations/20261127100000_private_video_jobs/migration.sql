-- Isolated staging jobs only. No media intake/delivery feature is enabled.
CREATE TABLE "PrivateVideoJob" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "actorId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "packageId" TEXT NOT NULL REFERENCES "Package"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "idempotencyKey" VARCHAR(128) NOT NULL,
 "fingerprint" VARCHAR(64) NOT NULL,
 "storageNamespace" VARCHAR(64) NOT NULL,
 "profile" JSONB NOT NULL,
 "status" VARCHAR(24) NOT NULL DEFAULT 'PREPARED',
 "attempts" INTEGER NOT NULL DEFAULT 0,
 "leaseToken" VARCHAR(36), "leaseExpiresAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "PrivateVideoJob_status_check" CHECK ("status" IN ('PREPARED','PROCESSING','REVIEW_REQUIRED','STORED')),
 CONSTRAINT "PrivateVideoJob_attempts_check" CHECK ("attempts" BETWEEN 0 AND 5),
 CONSTRAINT "PrivateVideoJob_lease_check" CHECK (("leaseToken" IS NULL) = ("leaseExpiresAt" IS NULL))
);
CREATE UNIQUE INDEX "PrivateVideoJob_actorId_idempotencyKey_key" ON "PrivateVideoJob"("actorId","idempotencyKey");
CREATE INDEX "PrivateVideoJob_status_leaseExpiresAt_idx" ON "PrivateVideoJob"("status","leaseExpiresAt");
CREATE INDEX "PrivateVideoJob_packageId_createdAt_idx" ON "PrivateVideoJob"("packageId","createdAt");
CREATE TABLE "PrivateVideoArtifact" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "jobId" TEXT NOT NULL REFERENCES "PrivateVideoJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "role" VARCHAR(16) NOT NULL,
 "status" VARCHAR(24) NOT NULL DEFAULT 'PREPARED',
 "preparedReference" JSONB NOT NULL, "encryptedBody" BYTEA, "storedReference" JSONB,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "PrivateVideoArtifact_role_check" CHECK ("role" IN ('original','video','poster')),
 CONSTRAINT "PrivateVideoArtifact_status_check" CHECK ("status" IN ('PREPARED','WRITING','STORED')),
 CONSTRAINT "PrivateVideoArtifact_stored_check" CHECK ("status" <> 'STORED' OR "storedReference" IS NOT NULL),
 CONSTRAINT "PrivateVideoArtifact_pending_check" CHECK ("status" = 'STORED' OR "encryptedBody" IS NOT NULL)
);
CREATE UNIQUE INDEX "PrivateVideoArtifact_jobId_role_key" ON "PrivateVideoArtifact"("jobId","role");
