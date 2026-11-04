CREATE TYPE "PackageServiceType" AS ENUM ('CONSOLIDATE', 'SPLIT', 'REPACK');
CREATE TYPE "PackageServiceStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED');
CREATE TYPE "PackageServicePackageRole" AS ENUM ('SOURCE', 'RESULT');

ALTER TABLE "Package" ADD COLUMN "isOutboundActive" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "PackageServiceRequest" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "executionIdempotencyKey" TEXT,
    "orderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" "PackageServiceType" NOT NULL,
    "status" "PackageServiceStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedOutputCount" INTEGER NOT NULL DEFAULT 1,
    "customerNote" TEXT,
    "adminNote" TEXT,
    "reviewCustomerNote" TEXT,
    "warehouseNote" TEXT,
    "reviewedById" TEXT,
    "completedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PackageServiceRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PackageServicePackage" (
    "requestId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "role" "PackageServicePackageRole" NOT NULL,
    CONSTRAINT "PackageServicePackage_pkey" PRIMARY KEY ("requestId", "packageId")
);

CREATE UNIQUE INDEX "PackageServiceRequest_reference_key" ON "PackageServiceRequest"("reference");
CREATE UNIQUE INDEX "PackageServiceRequest_idempotencyKey_key" ON "PackageServiceRequest"("idempotencyKey");
CREATE UNIQUE INDEX "PackageServiceRequest_executionIdempotencyKey_key" ON "PackageServiceRequest"("executionIdempotencyKey");
CREATE INDEX "PackageServiceRequest_customerId_status_createdAt_idx" ON "PackageServiceRequest"("customerId", "status", "createdAt");
CREATE INDEX "PackageServiceRequest_orderId_status_idx" ON "PackageServiceRequest"("orderId", "status");
CREATE INDEX "PackageServiceRequest_status_createdAt_idx" ON "PackageServiceRequest"("status", "createdAt");
CREATE INDEX "PackageServicePackage_packageId_role_idx" ON "PackageServicePackage"("packageId", "role");
ALTER TABLE "PackageServiceRequest" ADD CONSTRAINT "PackageServiceRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PackageServiceRequest" ADD CONSTRAINT "PackageServiceRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PackageServiceRequest" ADD CONSTRAINT "PackageServiceRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PackageServiceRequest" ADD CONSTRAINT "PackageServiceRequest_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PackageServicePackage" ADD CONSTRAINT "PackageServicePackage_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PackageServiceRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PackageServicePackage" ADD CONSTRAINT "PackageServicePackage_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
