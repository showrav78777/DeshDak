ALTER TABLE "User" ADD COLUMN "personCode" TEXT;
ALTER TABLE "SellerProfile" ADD COLUMN "storeCode" TEXT;
ALTER TABLE "Warehouse" ADD COLUMN "warehouseCode" TEXT;
ALTER TABLE "Shipment" ADD COLUMN "shipmentCode" TEXT;

UPDATE "User" SET "personCode" = 'PER-' || UPPER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', '') FROM 1 FOR 20)) WHERE "personCode" IS NULL;
UPDATE "SellerProfile" SET "storeCode" = 'STR-' || UPPER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', '') FROM 1 FOR 20)) WHERE "storeCode" IS NULL;
UPDATE "Warehouse" SET "warehouseCode" = 'WHS-' || UPPER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', '') FROM 1 FOR 20)) WHERE "warehouseCode" IS NULL;
UPDATE "Shipment" SET "shipmentCode" = 'SHP-' || UPPER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', '') FROM 1 FOR 20)) WHERE "shipmentCode" IS NULL;
UPDATE "Product" SET "productCode" = 'PRD-' || UPPER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', '') FROM 1 FOR 20)) WHERE "productCode" IS NULL;

ALTER TABLE "User" ALTER COLUMN "personCode" SET NOT NULL;
ALTER TABLE "SellerProfile" ALTER COLUMN "storeCode" SET NOT NULL;
ALTER TABLE "Warehouse" ALTER COLUMN "warehouseCode" SET NOT NULL;
ALTER TABLE "Shipment" ALTER COLUMN "shipmentCode" SET NOT NULL;
ALTER TABLE "Product" ALTER COLUMN "productCode" SET NOT NULL;

ALTER TABLE "User" ALTER COLUMN "personCode" SET DEFAULT ('PER-' || UPPER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', '') FROM 1 FOR 20)));
ALTER TABLE "SellerProfile" ALTER COLUMN "storeCode" SET DEFAULT ('STR-' || UPPER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', '') FROM 1 FOR 20)));
ALTER TABLE "Warehouse" ALTER COLUMN "warehouseCode" SET DEFAULT ('WHS-' || UPPER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', '') FROM 1 FOR 20)));
ALTER TABLE "Shipment" ALTER COLUMN "shipmentCode" SET DEFAULT ('SHP-' || UPPER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', '') FROM 1 FOR 20)));
ALTER TABLE "Product" ALTER COLUMN "productCode" SET DEFAULT ('PRD-' || UPPER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', '') FROM 1 FOR 20)));

CREATE UNIQUE INDEX "User_personCode_key" ON "User"("personCode");
CREATE UNIQUE INDEX "SellerProfile_storeCode_key" ON "SellerProfile"("storeCode");
CREATE UNIQUE INDEX "Warehouse_warehouseCode_key" ON "Warehouse"("warehouseCode");
CREATE UNIQUE INDEX "Shipment_shipmentCode_key" ON "Shipment"("shipmentCode");

ALTER TABLE "User" ADD CONSTRAINT "User_personCode_format_check" CHECK ("personCode" ~ '^PER-[A-F0-9]{20}$');
ALTER TABLE "SellerProfile" ADD CONSTRAINT "SellerProfile_storeCode_format_check" CHECK ("storeCode" ~ '^STR-[A-F0-9]{20}$');
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_warehouseCode_format_check" CHECK ("warehouseCode" ~ '^WHS-[A-F0-9]{20}$');
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_shipmentCode_format_check" CHECK ("shipmentCode" ~ '^SHP-[A-F0-9]{20}$');
