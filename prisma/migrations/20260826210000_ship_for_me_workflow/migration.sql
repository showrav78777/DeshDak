CREATE TYPE "ShipForMeRequestStatus" AS ENUM ('ADDRESS_ISSUED', 'TRACKING_SUBMITTED', 'WAREHOUSE_RECEIVED', 'CANCELLED');

CREATE TABLE "ShipForMeRequest" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "originWarehouseId" TEXT NOT NULL,
    "shippingLaneId" TEXT NOT NULL,
    "status" "ShipForMeRequestStatus" NOT NULL DEFAULT 'ADDRESS_ISSUED',
    "itemDescription" TEXT NOT NULL,
    "expectedPackageCount" INTEGER NOT NULL DEFAULT 1,
    "declaredValue" DECIMAL(12,2),
    "declaredCurrency" TEXT,
    "customerNote" TEXT,
    "warehouseAddress" JSONB NOT NULL,
    "inboundCarrier" TEXT,
    "inboundTracking" TEXT,
    "trackingIdempotencyKey" TEXT,
    "policyVersion" TEXT NOT NULL DEFAULT '1.1',
    "trackingSubmittedAt" TIMESTAMP(3),
    "warehouseReceivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShipForMeRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShipForMeRequest_reference_key" ON "ShipForMeRequest"("reference");
CREATE UNIQUE INDEX "ShipForMeRequest_idempotencyKey_key" ON "ShipForMeRequest"("idempotencyKey");
CREATE UNIQUE INDEX "ShipForMeRequest_orderId_key" ON "ShipForMeRequest"("orderId");
CREATE UNIQUE INDEX "ShipForMeRequest_trackingIdempotencyKey_key" ON "ShipForMeRequest"("trackingIdempotencyKey");
CREATE INDEX "ShipForMeRequest_customerId_status_createdAt_idx" ON "ShipForMeRequest"("customerId", "status", "createdAt");
CREATE INDEX "ShipForMeRequest_originWarehouseId_status_idx" ON "ShipForMeRequest"("originWarehouseId", "status");
CREATE INDEX "ShipForMeRequest_shippingLaneId_status_idx" ON "ShipForMeRequest"("shippingLaneId", "status");

ALTER TABLE "ShipForMeRequest" ADD CONSTRAINT "ShipForMeRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShipForMeRequest" ADD CONSTRAINT "ShipForMeRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShipForMeRequest" ADD CONSTRAINT "ShipForMeRequest_originWarehouseId_fkey" FOREIGN KEY ("originWarehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShipForMeRequest" ADD CONSTRAINT "ShipForMeRequest_shippingLaneId_fkey" FOREIGN KEY ("shippingLaneId") REFERENCES "ShippingLane"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
