CREATE TABLE "PrivatePhotoUpload" (
 "id" TEXT NOT NULL, "actorId" TEXT NOT NULL, "purpose" VARCHAR(16) NOT NULL,
 "idempotencyKey" VARCHAR(128) NOT NULL, "fingerprint" VARCHAR(64) NOT NULL,
 "storageNamespace" VARCHAR(64) NOT NULL, "status" VARCHAR(24) NOT NULL DEFAULT 'PREPARED',
 "preparedReference" JSONB NOT NULL, "encryptedBody" BYTEA, "storedReference" JSONB,
 "attempts" INTEGER NOT NULL DEFAULT 0, "leaseToken" VARCHAR(36), "leaseExpiresAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "PrivatePhotoUpload_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "PrivatePhotoUpload_status_check" CHECK ("status" IN ('PREPARED','STORED','REVIEW_REQUIRED')),
 CONSTRAINT "PrivatePhotoUpload_purpose_check" CHECK ("purpose" IN ('identity','inspection')),
 CONSTRAINT "PrivatePhotoUpload_attempts_check" CHECK ("attempts" BETWEEN 0 AND 5),
 CONSTRAINT "PrivatePhotoUpload_body_check" CHECK ("encryptedBody" IS NULL OR octet_length("encryptedBody") BETWEEN 17 AND 8388624),
 CONSTRAINT "PrivatePhotoUpload_lease_pair_check" CHECK (("leaseToken" IS NULL) = ("leaseExpiresAt" IS NULL)),
 CONSTRAINT "PrivatePhotoUpload_reference_check" CHECK (jsonb_typeof("preparedReference") = 'object' AND ("storedReference" IS NULL OR jsonb_typeof("storedReference") = 'object')),
 CONSTRAINT "PrivatePhotoUpload_stored_check" CHECK ("status" <> 'STORED' OR ("storedReference" IS NOT NULL AND "encryptedBody" IS NULL AND "leaseToken" IS NULL AND "leaseExpiresAt" IS NULL))
);
CREATE UNIQUE INDEX "PrivatePhotoUpload_actorId_idempotencyKey_key" ON "PrivatePhotoUpload"("actorId","idempotencyKey");
CREATE INDEX "PrivatePhotoUpload_status_leaseExpiresAt_idx" ON "PrivatePhotoUpload"("status","leaseExpiresAt");
CREATE INDEX "PrivatePhotoUpload_actorId_createdAt_idx" ON "PrivatePhotoUpload"("actorId","createdAt");
ALTER TABLE "PrivatePhotoUpload" ADD CONSTRAINT "PrivatePhotoUpload_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
