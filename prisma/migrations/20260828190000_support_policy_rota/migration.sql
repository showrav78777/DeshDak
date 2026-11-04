CREATE TYPE "SupportShiftStatus" AS ENUM ('SCHEDULED', 'CANCELLED');

ALTER TABLE "Ticket" ADD COLUMN "slaApproachingAt" TIMESTAMP(3);
UPDATE "Ticket" SET "slaApproachingAt" = "slaDueAt" - INTERVAL '24 hours' WHERE "slaApproachingAt" IS NULL;

CREATE TABLE "SupportOperatingPolicy" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "timeZone" TEXT NOT NULL DEFAULT 'Asia/Dhaka',
    "firstResponseBusinessDays" INTEGER NOT NULL DEFAULT 5,
    "approachingHours" INTEGER NOT NULL DEFAULT 24,
    "businessWeekdays" INTEGER[] NOT NULL DEFAULT ARRAY[1,2,3,4,5]::INTEGER[],
    "openingMinute" INTEGER NOT NULL DEFAULT 540,
    "closingMinute" INTEGER NOT NULL DEFAULT 1080,
    "requireScheduledShift" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SupportOperatingPolicy_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SupportOperatingPolicy_days_check" CHECK ("firstResponseBusinessDays" BETWEEN 1 AND 10),
    CONSTRAINT "SupportOperatingPolicy_approaching_check" CHECK ("approachingHours" BETWEEN 1 AND 168),
    CONSTRAINT "SupportOperatingPolicy_hours_check" CHECK ("openingMinute" BETWEEN 0 AND 1439 AND "closingMinute" BETWEEN 1 AND 1440 AND "closingMinute" > "openingMinute")
);

CREATE TABLE "SupportHoliday" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupportHoliday_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupportShift" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "SupportShiftStatus" NOT NULL DEFAULT 'SCHEDULED',
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SupportShift_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SupportShift_time_check" CHECK ("endsAt" > "startsAt")
);

CREATE UNIQUE INDEX "SupportHoliday_date_key" ON "SupportHoliday"("date");
CREATE INDEX "SupportOperatingPolicy_updatedById_updatedAt_idx" ON "SupportOperatingPolicy"("updatedById", "updatedAt");
CREATE INDEX "SupportShift_agentId_status_startsAt_endsAt_idx" ON "SupportShift"("agentId", "status", "startsAt", "endsAt");
CREATE INDEX "SupportShift_startsAt_endsAt_idx" ON "SupportShift"("startsAt", "endsAt");

ALTER TABLE "SupportOperatingPolicy" ADD CONSTRAINT "SupportOperatingPolicy_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupportShift" ADD CONSTRAINT "SupportShift_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupportShift" ADD CONSTRAINT "SupportShift_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
