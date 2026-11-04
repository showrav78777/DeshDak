import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { calculateProductCompleteness } from "../src/modules/catalog/completeness.ts";

const prisma = new PrismaClient();
const marker = randomBytes(8).toString("hex");
let productId;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  const completenessScore = calculateProductCompleteness({
    titleEn: "Complete verification product",
    titleBn: "সম্পূর্ণ যাচাই পণ্য",
    shortDescription: "A complete seller-authored catalog record.",
    description: "This deliberately complete description verifies that rich product data can be stored and retrieved through the canonical DeshDak catalog model without relying on an external seller storefront.",
    highlights: ["First verified highlight", "Second verified highlight", "Third verified highlight"],
    brand: "DeshDak Test",
    modelNumber: "RC-1",
    hsCode: "9999.99",
    minimumOrderQuantity: 2,
    productionLeadDaysMin: 3,
    productionLeadDaysMax: 7,
    sellingUnit: "set",
    packageContents: "Two verification items and one information card.",
    returnPolicy: "Return eligibility follows the reviewed DeshDak order policy.",
    warrantyInfo: "Verification warranty information.",
    hasPackedMeasurements: true,
    hasReadyMedia: true,
  });
  assert(completenessScore === 100, `Complete product scored ${completenessScore}, expected 100.`);

  const product = await prisma.product.create({
    data: {
      titleEn: "Rich catalog verification product",
      titleBn: "রিচ ক্যাটালগ যাচাই পণ্য",
      shortDescription: "Verifies the rich product catalog database contract.",
      description: "This temporary product validates storage and retrieval of seller-authored rich commerce information.",
      highlights: ["Structured content", "Provider-neutral", "DeshDak storefront"],
      brand: "DeshDak Test",
      modelNumber: "RC-1",
      status: "DRAFT",
      minimumOrderQuantity: 2,
      sampleAvailable: true,
      customizationAvailable: true,
      productionLeadDaysMin: 3,
      productionLeadDaysMax: 7,
      sellingUnit: "set",
      packageContents: "Two verification items.",
      returnPolicy: "Verification only.",
      warrantyInfo: "Verification only.",
      completenessScore,
      media: { create: { kind: "IMAGE", status: "READY", storageKey: `verification/${marker}.webp`, originalFilename: "never-exposed.jpg", mimeType: "image/webp", sizeBytes: 1024, checksumSha256: marker.padEnd(64, "0"), altText: "Rich catalog verification image", isPrimary: true } },
      variants: { create: { sku: `RICH-${marker.toUpperCase()}`, priceBdt: 1250, priceCurrency: "BDT", inventoryQuantity: 20, stockStatus: "IN_STOCK", weightGrams: 800, lengthMm: 200, widthMm: 150, heightMm: 100 } },
    },
    include: { media: true, variants: true },
  });
  productId = product.id;
  assert(product.media.length === 1 && product.media[0].status === "READY", "Ready media metadata was not stored with the product.");
  assert(product.variants.length === 1 && product.minimumOrderQuantity === 2, "Rich commerce terms or variant data were not stored.");
  assert(!Object.hasOwn(product.media[0], "publicUrl"), "Media storage unexpectedly exposes a direct public URL.");
  console.log("Rich catalog verification passed: completeness scoring, commerce terms, secure media metadata, variants, and provider-neutral storage are operational.");
} finally {
  if (productId) await prisma.product.deleteMany({ where: { id: productId } });
  await prisma.$disconnect();
}
