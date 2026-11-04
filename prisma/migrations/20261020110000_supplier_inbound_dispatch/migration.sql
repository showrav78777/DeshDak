CREATE TABLE "SupplierInboundDispatch" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "supplierRecordId" TEXT NOT NULL UNIQUE,
  "packageId" TEXT NOT NULL UNIQUE,
  "carrierName" TEXT NOT NULL,
  "trackingNumber" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL UNIQUE,
  "requestFingerprint" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupplierInboundDispatch_supplierRecordId_fkey" FOREIGN KEY ("supplierRecordId") REFERENCES "SupplierOrderRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SupplierInboundDispatch_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SupplierInboundDispatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "SupplierInboundDispatch_createdById_idx" ON "SupplierInboundDispatch"("createdById");
CREATE TRIGGER "SupplierInboundDispatch_append_only" BEFORE UPDATE OR DELETE ON "SupplierInboundDispatch"
FOR EACH ROW EXECUTE FUNCTION prevent_supplier_order_record_changes();
