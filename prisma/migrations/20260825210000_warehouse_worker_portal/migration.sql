CREATE TYPE "PackageEventType" AS ENUM ('RECEIVED', 'SCANNED', 'MEASURED', 'PUT_AWAY', 'NOTE_ADDED', 'LABEL_PRINTED');

CREATE TABLE "WarehouseStaffAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "assignedById" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deactivatedAt" TIMESTAMP(3),
    CONSTRAINT "WarehouseStaffAssignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PackageEvent" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "eventType" "PackageEventType" NOT NULL,
    "status" "PackageStatus" NOT NULL,
    "actorId" TEXT,
    "locationCode" TEXT,
    "note" TEXT,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PackageEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WarehouseStaffAssignment_userId_warehouseId_key" ON "WarehouseStaffAssignment"("userId", "warehouseId");
CREATE INDEX "WarehouseStaffAssignment_warehouseId_isActive_idx" ON "WarehouseStaffAssignment"("warehouseId", "isActive");
CREATE INDEX "WarehouseStaffAssignment_userId_isActive_idx" ON "WarehouseStaffAssignment"("userId", "isActive");
CREATE INDEX "PackageEvent_packageId_occurredAt_idx" ON "PackageEvent"("packageId", "occurredAt");
CREATE INDEX "PackageEvent_eventType_occurredAt_idx" ON "PackageEvent"("eventType", "occurredAt");

ALTER TABLE "WarehouseStaffAssignment" ADD CONSTRAINT "WarehouseStaffAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarehouseStaffAssignment" ADD CONSTRAINT "WarehouseStaffAssignment_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarehouseStaffAssignment" ADD CONSTRAINT "WarehouseStaffAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PackageEvent" ADD CONSTRAINT "PackageEvent_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PackageEvent" ADD CONSTRAINT "PackageEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
