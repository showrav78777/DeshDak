CREATE TABLE "ShippingPayment" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "shippingQuoteId" TEXT NOT NULL,
    "fxSnapshotId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingPayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShippingPayment_reference_key" ON "ShippingPayment"("reference");
CREATE UNIQUE INDEX "ShippingPayment_idempotencyKey_key" ON "ShippingPayment"("idempotencyKey");
CREATE UNIQUE INDEX "ShippingPayment_orderId_key" ON "ShippingPayment"("orderId");
CREATE UNIQUE INDEX "ShippingPayment_shippingQuoteId_key" ON "ShippingPayment"("shippingQuoteId");
CREATE INDEX "ShippingPayment_status_createdAt_idx" ON "ShippingPayment"("status", "createdAt");

ALTER TABLE "ShippingPayment" ADD CONSTRAINT "ShippingPayment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShippingPayment" ADD CONSTRAINT "ShippingPayment_shippingQuoteId_fkey" FOREIGN KEY ("shippingQuoteId") REFERENCES "ShippingQuote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShippingPayment" ADD CONSTRAINT "ShippingPayment_fxSnapshotId_fkey" FOREIGN KEY ("fxSnapshotId") REFERENCES "FxSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
