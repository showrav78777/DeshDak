-- CreateEnum
CREATE TYPE "RmaStatus" AS ENUM ('RETURN_REQUESTED', 'RETURN_APPROVED', 'RETURN_REJECTED', 'RETURN_IN_TRANSIT', 'RETURN_RECEIVED', 'INSPECTED', 'REFUNDED', 'REPLACED', 'CLOSED');

-- CreateEnum
CREATE TYPE "RmaReason" AS ENUM ('NOT_DELIVERED', 'LOST', 'WRONG_ITEM', 'DAMAGED', 'NOT_AS_DESCRIBED', 'MISSING_PARTS', 'MINOR_COSMETIC', 'OTHER');

-- CreateEnum
CREATE TYPE "RmaDecision" AS ENUM ('PENDING', 'FULL_REFUND', 'PARTIAL_REFUND', 'REPLACEMENT', 'REJECT');

-- CreateEnum
CREATE TYPE "LiabilityParty" AS ENUM ('PENDING', 'CUSTOMER', 'PLATFORM', 'SUPPLIER', 'CARRIER');

-- AlterTable
ALTER TABLE "Refund" ADD COLUMN "rmaId" TEXT;

-- CreateTable
CREATE TABLE "Rma" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" "RmaStatus" NOT NULL DEFAULT 'RETURN_REQUESTED',
    "reason" "RmaReason" NOT NULL,
    "description" TEXT NOT NULL,
    "evidenceRefs" JSONB NOT NULL,
    "claimDeadlineAtCreation" TIMESTAMP(3) NOT NULL,
    "createdAfterDeadline" BOOLEAN NOT NULL DEFAULT false,
    "overrideReason" TEXT,
    "overriddenById" TEXT,
    "overriddenAt" TIMESTAMP(3),
    "slaDueAt" TIMESTAMP(3) NOT NULL,
    "firstResponseAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "decision" "RmaDecision" NOT NULL DEFAULT 'PENDING',
    "liabilityParty" "LiabilityParty" NOT NULL DEFAULT 'PENDING',
    "approvedRefundAmount" DECIMAL(18,2),
    "returnRequired" BOOLEAN NOT NULL DEFAULT false,
    "returnInstructions" TEXT,
    "returnTrackingNumber" TEXT,
    "inspectionResult" TEXT,
    "inspectionNotes" TEXT,
    "inspectedById" TEXT,
    "inspectedAt" TIMESTAMP(3),
    "adminNotes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Rma_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RmaItem" (
    "id" TEXT NOT NULL,
    "rmaId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "orderItemId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "decision" "RmaDecision" NOT NULL DEFAULT 'PENDING',
    "refundAmount" DECIMAL(18,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RmaItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RmaEvent" (
    "id" TEXT NOT NULL,
    "rmaId" TEXT NOT NULL,
    "fromStatus" "RmaStatus",
    "toStatus" "RmaStatus" NOT NULL,
    "actorId" TEXT,
    "note" TEXT,
    "metadata" JSONB,
    "idempotencyKey" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RmaEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RmaMessage" (
    "id" TEXT NOT NULL,
    "rmaId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "evidenceRefs" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RmaMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Rma_reference_key" ON "Rma"("reference");
CREATE UNIQUE INDEX "Rma_idempotencyKey_key" ON "Rma"("idempotencyKey");
CREATE INDEX "Rma_customerId_createdAt_idx" ON "Rma"("customerId", "createdAt");
CREATE INDEX "Rma_orderId_status_idx" ON "Rma"("orderId", "status");
CREATE INDEX "Rma_shipmentId_status_idx" ON "Rma"("shipmentId", "status");
CREATE INDEX "Rma_claimDeadlineAtCreation_idx" ON "Rma"("claimDeadlineAtCreation");
CREATE INDEX "Rma_status_slaDueAt_idx" ON "Rma"("status", "slaDueAt");
CREATE INDEX "RmaItem_packageId_idx" ON "RmaItem"("packageId");
CREATE INDEX "RmaItem_orderItemId_idx" ON "RmaItem"("orderItemId");
CREATE UNIQUE INDEX "RmaItem_rmaId_packageId_key" ON "RmaItem"("rmaId", "packageId");
CREATE UNIQUE INDEX "RmaEvent_idempotencyKey_key" ON "RmaEvent"("idempotencyKey");
CREATE INDEX "RmaEvent_rmaId_occurredAt_idx" ON "RmaEvent"("rmaId", "occurredAt");
CREATE INDEX "RmaEvent_toStatus_occurredAt_idx" ON "RmaEvent"("toStatus", "occurredAt");
CREATE INDEX "RmaMessage_rmaId_createdAt_idx" ON "RmaMessage"("rmaId", "createdAt");
CREATE INDEX "RmaMessage_senderId_createdAt_idx" ON "RmaMessage"("senderId", "createdAt");
CREATE INDEX "Refund_rmaId_status_idx" ON "Refund"("rmaId", "status");

ALTER TABLE "Refund" ADD CONSTRAINT "Refund_rmaId_fkey" FOREIGN KEY ("rmaId") REFERENCES "Rma"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Rma" ADD CONSTRAINT "Rma_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Rma" ADD CONSTRAINT "Rma_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Rma" ADD CONSTRAINT "Rma_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Rma" ADD CONSTRAINT "Rma_overriddenById_fkey" FOREIGN KEY ("overriddenById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Rma" ADD CONSTRAINT "Rma_inspectedById_fkey" FOREIGN KEY ("inspectedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RmaItem" ADD CONSTRAINT "RmaItem_rmaId_fkey" FOREIGN KEY ("rmaId") REFERENCES "Rma"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RmaItem" ADD CONSTRAINT "RmaItem_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RmaItem" ADD CONSTRAINT "RmaItem_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RmaEvent" ADD CONSTRAINT "RmaEvent_rmaId_fkey" FOREIGN KEY ("rmaId") REFERENCES "Rma"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RmaEvent" ADD CONSTRAINT "RmaEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RmaMessage" ADD CONSTRAINT "RmaMessage_rmaId_fkey" FOREIGN KEY ("rmaId") REFERENCES "Rma"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RmaMessage" ADD CONSTRAINT "RmaMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
