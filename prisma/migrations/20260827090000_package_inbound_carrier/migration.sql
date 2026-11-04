ALTER TABLE "Package" ADD COLUMN "inboundCarrier" TEXT;

UPDATE "Package" AS p
SET "inboundCarrier" = s."inboundCarrier"
FROM "Order" AS o
JOIN "ShipForMeRequest" AS s ON s."orderId" = o."id"
WHERE p."orderId" = o."id" AND p."inboundCarrier" IS NULL;
