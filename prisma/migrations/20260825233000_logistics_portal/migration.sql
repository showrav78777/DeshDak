ALTER TYPE "ShipmentStatus" ADD VALUE IF NOT EXISTS 'PICKUP_PENDING';
ALTER TYPE "ShipmentStatus" ADD VALUE IF NOT EXISTS 'PICKED_UP';
ALTER TYPE "ShipmentStatus" ADD VALUE IF NOT EXISTS 'CONSOLIDATED';
ALTER TYPE "ShipmentStatus" ADD VALUE IF NOT EXISTS 'DEPARTED_ORIGIN';
ALTER TYPE "ShipmentStatus" ADD VALUE IF NOT EXISTS 'DESTINATION_ARRIVAL';
ALTER TYPE "ShipmentStatus" ADD VALUE IF NOT EXISTS 'CUSTOMS_CLEARED';
ALTER TYPE "ShipmentStatus" ADD VALUE IF NOT EXISTS 'FAILED_DELIVERY';
ALTER TYPE "ShipmentStatus" ADD VALUE IF NOT EXISTS 'DAMAGED';
ALTER TYPE "ShipmentStatus" ADD VALUE IF NOT EXISTS 'LOST';
ALTER TYPE "ShipmentStatus" ADD VALUE IF NOT EXISTS 'HELD';
ALTER TYPE "ShipmentStatus" ADD VALUE IF NOT EXISTS 'RETURNED';
ALTER TYPE "ShipmentStatus" ADD VALUE IF NOT EXISTS 'CUSTOMS_EXCEPTION';

ALTER TABLE "Shipment" ADD COLUMN "claimDeadline" TIMESTAMP(3);
ALTER TABLE "ShipmentEvent" ADD COLUMN "mediaRefs" JSONB;
ALTER TABLE "ShipmentEvent" ADD COLUMN "metadata" JSONB;
ALTER TABLE "ShipmentEvent" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "ShipmentEvent_idempotencyKey_key" ON "ShipmentEvent"("idempotencyKey");
CREATE INDEX "Shipment_originWarehouseId_status_idx" ON "Shipment"("originWarehouseId", "status");
CREATE INDEX "Shipment_destinationWarehouseId_status_idx" ON "Shipment"("destinationWarehouseId", "status");

ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_originWarehouseId_fkey" FOREIGN KEY ("originWarehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_destinationWarehouseId_fkey" FOREIGN KEY ("destinationWarehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShipmentEvent" ADD CONSTRAINT "ShipmentEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
