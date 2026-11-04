CREATE TYPE "LaunchReadinessCategory" AS ENUM ('INFRASTRUCTURE', 'PAYMENTS', 'IDENTITY_DELIVERY', 'MEDIA', 'LEGAL_COMPLIANCE', 'OPERATIONS', 'STAFFING', 'SECURITY', 'AUTOMATION', 'OTHER');
CREATE TYPE "LaunchReadinessStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'BLOCKED', 'EVIDENCE_RECORDED', 'VERIFIED');

CREATE TABLE "LaunchReadinessItem" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "category" "LaunchReadinessCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "requirement" TEXT NOT NULL,
    "status" "LaunchReadinessStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "isBaseline" BOOLEAN NOT NULL DEFAULT false,
    "ownerName" TEXT,
    "dueAt" TIMESTAMP(3),
    "evidenceReference" TEXT,
    "evidenceNote" TEXT,
    "blockerReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "updatedById" TEXT,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LaunchReadinessItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LaunchReadinessItem_key_key" ON "LaunchReadinessItem"("key");
CREATE INDEX "LaunchReadinessItem_status_category_idx" ON "LaunchReadinessItem"("status", "category");
CREATE INDEX "LaunchReadinessItem_isRequired_status_idx" ON "LaunchReadinessItem"("isRequired", "status");
CREATE INDEX "LaunchReadinessItem_dueAt_idx" ON "LaunchReadinessItem"("dueAt");

ALTER TABLE "LaunchReadinessItem" ADD CONSTRAINT "LaunchReadinessItem_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LaunchReadinessItem" ADD CONSTRAINT "LaunchReadinessItem_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LaunchReadinessItem" ADD CONSTRAINT "LaunchReadinessItem_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "LaunchReadinessItem" ("id", "key", "category", "title", "requirement", "isRequired", "isBaseline", "updatedAt") VALUES
  (gen_random_uuid()::text, 'production-infrastructure', 'INFRASTRUCTURE', 'Production infrastructure', 'HTTPS domain, isolated PostgreSQL, pooling, CDN/WAF, secret manager, monitoring, encrypted backups, restore drill and rollback evidence.', true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'payment-provider', 'PAYMENTS', 'Launch payment provider', 'Hosted checkout, signed webhooks, sandbox failure paths, refunds, reconciliation, settlement and chargeback evidence.', true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'captcha-email', 'IDENTITY_DELIVERY', 'Human verification and transactional email', 'Production CAPTCHA plus verified sender domain, secure delivery, bounce and suppression handling.', true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'private-media', 'MEDIA', 'Private product and evidence media', 'Signed uploads, type and size validation, malware scanning, metadata removal, processing, CDN and retention controls.', true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'legal-policy', 'LEGAL_COMPLIANCE', 'Approved legal and compliance policies', 'Company identity, terms, privacy/cookies, returns, seller terms, restricted goods, wallet and marketing wording approved by qualified owners.', true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'warehouse-lane', 'OPERATIONS', 'Warehouse and launch shipping lane', 'Real warehouse, carrier procedure, rates, packaging, labels, scanners, devices and escalation contacts physically accepted.', true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'named-staff', 'STAFFING', 'Named least-privilege staff', 'Separate MFA-protected accounts, shifts, approval limits, recovery procedures and training for every launch role.', true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'independent-security', 'SECURITY', 'Independent security and capacity review', 'Penetration, dependency and infrastructure review plus measured load and soak evidence with accepted capacity.', true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'production-automation', 'AUTOMATION', 'Production schedulers and alerts', 'Secret-manager-backed scheduler credentials, managed schedules, retries, monitoring, paging and named operational ownership.', true, true, CURRENT_TIMESTAMP);
