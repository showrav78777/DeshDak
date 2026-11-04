CREATE TYPE "IdentityDocumentType" AS ENUM ('NATIONAL_ID', 'PASSPORT', 'DRIVING_LICENSE');

ALTER TABLE "User" ADD COLUMN "phoneVerifiedAt" TIMESTAMP(3);

CREATE TABLE "IdentityVerification" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "documentType" "IdentityDocumentType" NOT NULL,
  "issuingCountryCode" VARCHAR(2) NOT NULL,
  "documentNumberLast4" VARCHAR(4) NOT NULL,
  "status" "KycStatus" NOT NULL DEFAULT 'PENDING',
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "reviewedById" TEXT,
  "reviewNote" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "IdentityVerification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "IdentityVerification_userId_status_submittedAt_idx" ON "IdentityVerification"("userId", "status", "submittedAt");
CREATE INDEX "IdentityVerification_status_submittedAt_idx" ON "IdentityVerification"("status", "submittedAt");

ALTER TABLE "IdentityVerification" ADD CONSTRAINT "IdentityVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IdentityVerification" ADD CONSTRAINT "IdentityVerification_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TYPE "SecurityTokenPurpose" ADD VALUE 'PHONE_VERIFICATION';
