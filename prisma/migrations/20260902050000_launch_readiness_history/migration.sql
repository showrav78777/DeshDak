CREATE TABLE "LaunchReadinessEvent" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "actorId" TEXT,
    "fromStatus" "LaunchReadinessStatus",
    "toStatus" "LaunchReadinessStatus" NOT NULL,
    "itemVersion" INTEGER NOT NULL,
    "ownerNameSnapshot" TEXT,
    "dueAtSnapshot" TIMESTAMP(3),
    "evidenceReferenceSnapshot" TEXT,
    "evidenceNoteSnapshot" TEXT,
    "blockerReasonSnapshot" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LaunchReadinessEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LaunchReadinessEvent_itemId_itemVersion_key" ON "LaunchReadinessEvent"("itemId", "itemVersion");
CREATE INDEX "LaunchReadinessEvent_itemId_occurredAt_idx" ON "LaunchReadinessEvent"("itemId", "occurredAt");
CREATE INDEX "LaunchReadinessEvent_toStatus_occurredAt_idx" ON "LaunchReadinessEvent"("toStatus", "occurredAt");

ALTER TABLE "LaunchReadinessEvent" ADD CONSTRAINT "LaunchReadinessEvent_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "LaunchReadinessItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LaunchReadinessEvent" ADD CONSTRAINT "LaunchReadinessEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "LaunchReadinessEvent" ("id", "itemId", "fromStatus", "toStatus", "itemVersion", "ownerNameSnapshot", "dueAtSnapshot", "evidenceReferenceSnapshot", "evidenceNoteSnapshot", "blockerReasonSnapshot", "occurredAt")
SELECT gen_random_uuid()::text, "id", NULL, "status", "version", "ownerName", "dueAt", "evidenceReference", "evidenceNote", "blockerReason", "createdAt"
FROM "LaunchReadinessItem";
