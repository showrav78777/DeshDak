CREATE TABLE "SupplierOrderRecord" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "orderItemId" TEXT,
  "allocationKey" TEXT NOT NULL,
  "supplierName" TEXT NOT NULL,
  "supplierOrderReference" TEXT NOT NULL,
  "supplierReferenceKey" TEXT NOT NULL,
  "variantDescription" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL CHECK ("quantity" > 0 AND "quantity" <= 1000000),
  "originWarehouseId" TEXT NOT NULL,
  "originCountryCode" TEXT NOT NULL,
  "recordedById" TEXT NOT NULL,
  "internalNote" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupplierOrderRecord_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupplierOrderRecord_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SupplierOrderRecord_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SupplierOrderRecord_originWarehouseId_fkey" FOREIGN KEY ("originWarehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SupplierOrderRecord_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SupplierOrderRecord_idempotencyKey_key" ON "SupplierOrderRecord"("idempotencyKey");
CREATE UNIQUE INDEX "SupplierOrderRecord_reference_key" ON "SupplierOrderRecord"("orderId", "allocationKey", "supplierReferenceKey");
CREATE INDEX "SupplierOrderRecord_orderId_createdAt_idx" ON "SupplierOrderRecord"("orderId", "createdAt");
CREATE INDEX "SupplierOrderRecord_orderItemId_idx" ON "SupplierOrderRecord"("orderItemId");
CREATE INDEX "SupplierOrderRecord_originWarehouseId_idx" ON "SupplierOrderRecord"("originWarehouseId");
CREATE INDEX "SupplierOrderRecord_recordedById_idx" ON "SupplierOrderRecord"("recordedById");
CREATE FUNCTION prevent_supplier_order_record_changes() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Supplier order records are append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "SupplierOrderRecord_append_only" BEFORE UPDATE OR DELETE ON "SupplierOrderRecord"
FOR EACH ROW EXECUTE FUNCTION prevent_supplier_order_record_changes();
