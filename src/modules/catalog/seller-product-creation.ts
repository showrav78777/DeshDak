import { type Prisma } from "@prisma/client";
import { calculateProductCompleteness } from "@/modules/catalog/completeness";
import { type SellerProductInput } from "@/modules/catalog/seller-product-input";
import { createPlatformCode } from "@/modules/identifiers/service";

export type SellerProductCreationContext = {
  id: string;
  originCountryCode: string;
  shipsInternationally: boolean;
};

export async function createSellerProduct(
  tx: Prisma.TransactionClient,
  input: SellerProductInput,
  seller: SellerProductCreationContext,
  actorId: string,
  submissionMode: "MANUAL" | "CSV_IMPORT",
  options: { catalogImportId?: string; catalogImportRowId?: string; sourcePlatformId?: string } = {},
) {
  const category = await tx.category.findFirst({ where: { id: input.categoryId, isActive: true }, select: { id: true } });
  if (!category) throw new Error("CATEGORY_NOT_AVAILABLE");
  if (input.sku) {
    const conflict = await tx.productVariant.findUnique({ where: { sku: input.sku }, select: { id: true } });
    if (conflict) throw new Error("SKU_ALREADY_USED");
  }
  const localSource = options.sourcePlatformId
    ? { id: options.sourcePlatformId }
    : await tx.sourcePlatform.upsert({
      where: { code: "LOCAL_SELLER" },
      update: { supportedCountries: ["BD"], supportsOrders: true, isActive: true },
      create: { code: "LOCAL_SELLER", displayName: "Bangladesh local sellers", supportedCountries: ["BD"], supportsOrders: true, isActive: true },
      select: { id: true },
    });
  const effectiveInput = { ...input, isInternationallyAvailable: seller.shipsInternationally && input.isInternationallyAvailable };
  const completenessScore = calculateProductCompleteness({ ...effectiveInput, hasPackedMeasurements: true, hasReadyMedia: false });
  const product = await tx.product.create({
    data: {
      productCode: createPlatformCode("PRODUCT"),
      titleEn: effectiveInput.titleEn,
      titleBn: effectiveInput.titleBn || null,
      shortDescription: effectiveInput.shortDescription,
      description: effectiveInput.description,
      highlights: effectiveInput.highlights,
      brand: effectiveInput.brand || null,
      modelNumber: effectiveInput.modelNumber || null,
      categoryId: category.id,
      status: "PENDING_REVIEW",
      sellerProfileId: seller.id,
      originCountryCode: seller.originCountryCode,
      isInternationallyAvailable: effectiveInput.isInternationallyAvailable,
      hsCode: effectiveInput.hsCode || null,
      minimumOrderQuantity: effectiveInput.minimumOrderQuantity,
      sampleAvailable: effectiveInput.sampleAvailable,
      customizationAvailable: effectiveInput.customizationAvailable,
      productionLeadDaysMin: effectiveInput.productionLeadDaysMin,
      productionLeadDaysMax: effectiveInput.productionLeadDaysMax,
      sellingUnit: effectiveInput.sellingUnit,
      packageContents: effectiveInput.packageContents,
      returnPolicy: effectiveInput.returnPolicy || null,
      warrantyInfo: effectiveInput.warrantyInfo || null,
      completenessScore,
      sources: { create: { sourcePlatformId: localSource.id } },
      variants: { create: {
        sku: effectiveInput.sku || null,
        priceBdt: effectiveInput.priceBdt,
        priceCurrency: "BDT",
        inventoryQuantity: effectiveInput.inventoryQuantity,
        stockStatus: effectiveInput.stockStatus,
        weightGrams: effectiveInput.weightGrams,
        lengthMm: effectiveInput.lengthMm,
        widthMm: effectiveInput.widthMm,
        heightMm: effectiveInput.heightMm,
      } },
    },
    include: { variants: true },
  });
  await tx.auditLog.create({
    data: {
      actorId,
      action: "seller.product_submitted",
      entityType: "Product",
      entityId: product.id,
      metadata: {
        productCode: product.productCode,
        categoryId: category.id,
        originCountryCode: seller.originCountryCode,
        international: product.isInternationallyAvailable,
        completenessScore,
        submissionMode,
        ...(options.catalogImportId ? { catalogImportId: options.catalogImportId } : {}),
        ...(options.catalogImportRowId ? { catalogImportRowId: options.catalogImportRowId } : {}),
      },
    },
  });
  return product;
}
