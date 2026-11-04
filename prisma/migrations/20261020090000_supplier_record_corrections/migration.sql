CREATE TABLE "SupplierRecordCorrection" (
  "originalRecordId" TEXT NOT NULL PRIMARY KEY,
  "replacementRecordId" TEXT NOT NULL UNIQUE,
  "holdHistoryId" TEXT NOT NULL UNIQUE,
  "approvedById" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupplierRecordCorrection_originalRecordId_fkey" FOREIGN KEY ("originalRecordId") REFERENCES "SupplierOrderRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SupplierRecordCorrection_replacementRecordId_fkey" FOREIGN KEY ("replacementRecordId") REFERENCES "SupplierOrderRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SupplierRecordCorrection_holdHistoryId_fkey" FOREIGN KEY ("holdHistoryId") REFERENCES "OrderStatusHistory"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SupplierRecordCorrection_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SupplierRecordCorrection_distinct_records" CHECK ("originalRecordId" <> "replacementRecordId")
);
CREATE INDEX "SupplierRecordCorrection_approvedById_idx" ON "SupplierRecordCorrection"("approvedById");
CREATE TRIGGER "SupplierRecordCorrection_append_only" BEFORE UPDATE OR DELETE ON "SupplierRecordCorrection"
FOR EACH ROW EXECUTE FUNCTION prevent_supplier_order_record_changes();
DROP INDEX "SupplierOrderRecord_reference_key";
CREATE INDEX "SupplierOrderRecord_reference_idx" ON "SupplierOrderRecord"("orderId", "allocationKey", "supplierReferenceKey");
