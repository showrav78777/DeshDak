CREATE TYPE "PackageExceptionType" AS ENUM ('MISSING_EXPECTED', 'EXTRA_UNEXPECTED', 'TRACKING_MISMATCH', 'DAMAGED_ON_ARRIVAL', 'MISSING_REFERENCE', 'RESTRICTED_ITEM', 'OTHER');
CREATE TYPE "PackageExceptionStatus" AS ENUM ('OPEN', 'RESOLVED', 'CANCELLED');

CREATE TABLE "PackageException" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "type" "PackageExceptionType" NOT NULL,
    "status" "PackageExceptionStatus" NOT NULL DEFAULT 'OPEN',
    "orderId" TEXT NOT NULL,
    "packageId" TEXT,
    "warehouseId" TEXT NOT NULL,
    "reportedById" TEXT NOT NULL,
    "resolvedById" TEXT,
    "description" TEXT NOT NULL,
    "resolutionNote" TEXT,
    "customerNote" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PackageException_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PackageException_reference_key" ON "PackageException"("reference");
CREATE UNIQUE INDEX "PackageException_idempotencyKey_key" ON "PackageException"("idempotencyKey");
CREATE INDEX "PackageException_status_createdAt_idx" ON "PackageException"("status", "createdAt");
CREATE INDEX "PackageException_orderId_status_idx" ON "PackageException"("orderId", "status");
CREATE INDEX "PackageException_warehouseId_status_idx" ON "PackageException"("warehouseId", "status");
CREATE INDEX "PackageException_packageId_status_idx" ON "PackageException"("packageId", "status");
ALTER TABLE "PackageException" ADD CONSTRAINT "PackageException_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PackageException" ADD CONSTRAINT "PackageException_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PackageException" ADD CONSTRAINT "PackageException_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PackageException" ADD CONSTRAINT "PackageException_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PackageException" ADD CONSTRAINT "PackageException_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
