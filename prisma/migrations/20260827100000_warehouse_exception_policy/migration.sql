CREATE TABLE "WarehouseExceptionPolicy" (
    "key" TEXT NOT NULL DEFAULT 'GLOBAL',
    "expectedParcelAlertHours" INTEGER NOT NULL DEFAULT 168,
    "exceptionResolutionHours" INTEGER NOT NULL DEFAULT 24,
    "storageWarningDays" INTEGER NOT NULL DEFAULT 30,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WarehouseExceptionPolicy_pkey" PRIMARY KEY ("key")
);

ALTER TABLE "WarehouseExceptionPolicy" ADD CONSTRAINT "WarehouseExceptionPolicy_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
