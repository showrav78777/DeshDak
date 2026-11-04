ALTER TYPE "ShipForMeRequestStatus" ADD VALUE 'PARTIALLY_RECEIVED';
CREATE UNIQUE INDEX "Package_inboundTracking_key" ON "Package"("inboundTracking");
