ALTER TABLE "Package" ADD COLUMN "receiveIdempotencyKey" TEXT;
CREATE UNIQUE INDEX "Package_receiveIdempotencyKey_key" ON "Package"("receiveIdempotencyKey");
