import { PrismaClient } from "@prisma/client";
import { createPlatformCode } from "../src/modules/identifiers/service.ts";

const prisma = new PrismaClient();
let temporaryProductId;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  const [summary] = await prisma.$queryRaw`
    SELECT
      COUNT(*)::int AS "total",
      COUNT(*) FILTER (WHERE "productCode" IS NULL)::int AS "missing",
      COUNT(DISTINCT "productCode")::int AS "distinctCodes"
    FROM "Product"
  `;
  assert(summary.missing === 0, `${summary.missing} existing products are missing a platform code.`);
  assert(summary.distinctCodes === summary.total, "Existing product platform codes are not unique.");

  const entitySummaries = await prisma.$queryRaw`
    SELECT 'User' AS entity, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE "personCode" IS NULL)::int AS missing, COUNT(DISTINCT "personCode")::int AS distinct_codes FROM "User"
    UNION ALL SELECT 'SellerProfile', COUNT(*)::int, COUNT(*) FILTER (WHERE "storeCode" IS NULL)::int, COUNT(DISTINCT "storeCode")::int FROM "SellerProfile"
    UNION ALL SELECT 'Warehouse', COUNT(*)::int, COUNT(*) FILTER (WHERE "warehouseCode" IS NULL)::int, COUNT(DISTINCT "warehouseCode")::int FROM "Warehouse"
    UNION ALL SELECT 'Shipment', COUNT(*)::int, COUNT(*) FILTER (WHERE "shipmentCode" IS NULL)::int, COUNT(DISTINCT "shipmentCode")::int FROM "Shipment"
  `;
  for (const entity of entitySummaries) {
    assert(entity.missing === 0, `${entity.entity} has missing business codes.`);
    assert(entity.distinct_codes === entity.total, `${entity.entity} business codes are not unique.`);
  }

  const productCode = createPlatformCode("PRODUCT");
  const created = await prisma.product.create({ data: { productCode, titleEn: "Identifier verification product", status: "DRAFT" } });
  temporaryProductId = created.id;
  const resolved = await prisma.product.findUnique({ where: { productCode } });
  assert(resolved?.id === created.id, "A product could not be resolved by its platform code.");

  let duplicateRejected = false;
  try {
    await prisma.product.create({ data: { productCode, titleEn: "Duplicate identifier verification product", status: "DRAFT" } });
  } catch (error) {
    duplicateRejected = error?.code === "P2002";
  }
  assert(duplicateRejected, "The database accepted a duplicate product platform code.");

  console.log(`Identifier database verification passed: people, stores, products, warehouses, and shipments are complete and unique; product lookup and duplicate rejection work.`);
} finally {
  if (temporaryProductId) await prisma.product.deleteMany({ where: { id: temporaryProductId } });
  await prisma.$disconnect();
}
