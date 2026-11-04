CREATE TYPE "BusinessAccountStatus" AS ENUM ('ACTIVE', 'ON_HOLD', 'CLOSED');
CREATE TYPE "KamAssignmentRole" AS ENUM ('PRIMARY', 'SUPPORT');
CREATE TYPE "AccountActivityType" AS ENUM ('CALL', 'MEETING', 'EMAIL', 'NOTE', 'FOLLOW_UP');

INSERT INTO "Role" ("id", "code", "description", "createdAt", "updatedAt")
VALUES (gen_random_uuid()::text, 'kam', 'Key Account Manager', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

CREATE TABLE "BusinessAccount" (
  "id" TEXT NOT NULL,
  "accountCode" TEXT NOT NULL DEFAULT ('ACC-' || UPPER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', '') FROM 1 FOR 20))),
  "ownerId" TEXT NOT NULL,
  "organizationName" TEXT NOT NULL,
  "status" "BusinessAccountStatus" NOT NULL DEFAULT 'ACTIVE',
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BusinessAccount_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BusinessAccount_accountCode_format_check" CHECK ("accountCode" ~ '^ACC-[A-F0-9]{20}$')
);

CREATE TABLE "KamAssignment" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "KamAssignmentRole" NOT NULL DEFAULT 'PRIMARY',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "assignedById" TEXT NOT NULL,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deactivatedAt" TIMESTAMP(3),
  CONSTRAINT "KamAssignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AccountActivity" (
  "id" TEXT NOT NULL,
  "activityCode" TEXT NOT NULL DEFAULT ('ACT-' || UPPER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', '') FROM 1 FOR 20))),
  "accountId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "type" "AccountActivityType" NOT NULL,
  "subject" TEXT NOT NULL,
  "note" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "followUpAt" TIMESTAMP(3),
  "sourcingRequestId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountActivity_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AccountActivity_activityCode_format_check" CHECK ("activityCode" ~ '^ACT-[A-F0-9]{20}$')
);

CREATE UNIQUE INDEX "BusinessAccount_accountCode_key" ON "BusinessAccount"("accountCode");
CREATE UNIQUE INDEX "BusinessAccount_ownerId_key" ON "BusinessAccount"("ownerId");
CREATE INDEX "BusinessAccount_status_createdAt_idx" ON "BusinessAccount"("status", "createdAt");
CREATE UNIQUE INDEX "KamAssignment_accountId_userId_key" ON "KamAssignment"("accountId", "userId");
CREATE INDEX "KamAssignment_userId_isActive_idx" ON "KamAssignment"("userId", "isActive");
CREATE INDEX "KamAssignment_accountId_isActive_idx" ON "KamAssignment"("accountId", "isActive");
CREATE UNIQUE INDEX "AccountActivity_activityCode_key" ON "AccountActivity"("activityCode");
CREATE UNIQUE INDEX "AccountActivity_idempotencyKey_key" ON "AccountActivity"("idempotencyKey");
CREATE INDEX "AccountActivity_accountId_occurredAt_idx" ON "AccountActivity"("accountId", "occurredAt");
CREATE INDEX "AccountActivity_authorId_createdAt_idx" ON "AccountActivity"("authorId", "createdAt");
CREATE INDEX "AccountActivity_followUpAt_idx" ON "AccountActivity"("followUpAt");

ALTER TABLE "BusinessAccount" ADD CONSTRAINT "BusinessAccount_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KamAssignment" ADD CONSTRAINT "KamAssignment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "BusinessAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KamAssignment" ADD CONSTRAINT "KamAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KamAssignment" ADD CONSTRAINT "KamAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountActivity" ADD CONSTRAINT "AccountActivity_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "BusinessAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountActivity" ADD CONSTRAINT "AccountActivity_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountActivity" ADD CONSTRAINT "AccountActivity_sourcingRequestId_fkey" FOREIGN KEY ("sourcingRequestId") REFERENCES "SourcingRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
