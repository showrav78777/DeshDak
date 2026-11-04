import { z } from "zod";

const optionalText = (maximum: number) => z.string().trim().max(maximum).optional();

export const sellerProductInputSchema = z.object({
  titleEn: z.string().trim().min(3).max(180),
  titleBn: optionalText(180),
  shortDescription: z.string().trim().min(10).max(300),
  description: z.string().trim().min(20).max(3000),
  highlights: z.union([
    z.string().trim().min(3).max(1500).transform((value) => value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean).slice(0, 12)),
    z.array(z.string().trim().min(1).max(200)).min(1).max(12),
  ]),
  brand: optionalText(100),
  modelNumber: optionalText(100),
  categoryId: z.string().uuid(),
  sku: optionalText(80),
  priceBdt: z.coerce.number().positive().max(9_999_999),
  inventoryQuantity: z.coerce.number().int().min(0).max(1_000_000),
  stockStatus: z.enum(["IN_STOCK", "MADE_TO_ORDER", "OUT_OF_STOCK"]),
  weightGrams: z.coerce.number().int().min(1).max(1_000_000),
  lengthMm: z.coerce.number().int().min(1).max(100_000),
  widthMm: z.coerce.number().int().min(1).max(100_000),
  heightMm: z.coerce.number().int().min(1).max(100_000),
  minimumOrderQuantity: z.coerce.number().int().min(1).max(1_000_000),
  productionLeadDaysMin: z.coerce.number().int().min(0).max(3650),
  productionLeadDaysMax: z.coerce.number().int().min(0).max(3650),
  sellingUnit: z.string().trim().min(1).max(80),
  packageContents: z.string().trim().min(3).max(1000),
  returnPolicy: optionalText(1200),
  warrantyInfo: optionalText(1200),
  sampleAvailable: z.preprocess((value) => value === true || value === "on", z.boolean()),
  customizationAvailable: z.preprocess((value) => value === true || value === "on", z.boolean()),
  hsCode: optionalText(20).refine((value) => !value || /^[0-9.\s-]*$/.test(value), "Use only digits, dots, spaces, or dashes."),
  isInternationallyAvailable: z.preprocess((value) => value === true || value === "on", z.boolean()),
}).superRefine((value, context) => {
  if (value.productionLeadDaysMax < value.productionLeadDaysMin) context.addIssue({ code: "custom", path: ["productionLeadDaysMax"], message: "Maximum lead time must be the same as or greater than the minimum." });
  if (value.stockStatus === "IN_STOCK" && value.minimumOrderQuantity > value.inventoryQuantity) context.addIssue({ code: "custom", path: ["minimumOrderQuantity"], message: "Minimum order quantity cannot exceed available stock." });
});

export type SellerProductInput = z.infer<typeof sellerProductInputSchema>;

export function revisionPayload(input: SellerProductInput) {
  return {
    productPayload: {
      titleEn: input.titleEn,
      titleBn: input.titleBn || null,
      shortDescription: input.shortDescription,
      description: input.description,
      highlights: input.highlights,
      brand: input.brand || null,
      modelNumber: input.modelNumber || null,
      categoryId: input.categoryId,
      isInternationallyAvailable: input.isInternationallyAvailable,
      hsCode: input.hsCode || null,
      minimumOrderQuantity: input.minimumOrderQuantity,
      sampleAvailable: input.sampleAvailable,
      customizationAvailable: input.customizationAvailable,
      productionLeadDaysMin: input.productionLeadDaysMin,
      productionLeadDaysMax: input.productionLeadDaysMax,
      sellingUnit: input.sellingUnit,
      packageContents: input.packageContents,
      returnPolicy: input.returnPolicy || null,
      warrantyInfo: input.warrantyInfo || null,
    },
    variantPayload: {
      sku: input.sku || null,
      priceBdt: input.priceBdt,
      inventoryQuantity: input.inventoryQuantity,
      stockStatus: input.stockStatus,
      weightGrams: input.weightGrams,
      lengthMm: input.lengthMm,
      widthMm: input.widthMm,
      heightMm: input.heightMm,
    },
  };
}
