import { Prisma } from "@prisma/client";
import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { calculateProductCompleteness } from "@/modules/catalog/completeness";
import { revisionPayload, sellerProductInputSchema } from "@/modules/catalog/seller-product-input";

const submissionSchema = sellerProductInputSchema.and(z.object({ baseProductVersion: z.coerce.number().int().positive() }));

export async function GET(request: NextRequest, context: RouteContext<"/api/v1/seller/products/[productId]/revisions">) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.SELLER) || session.portal !== "seller") return apiError("SELLER_ACCESS_REQUIRED", "Seller access is required.", 403);
  const { productId } = await context.params;
  const product = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null, sellerProfile: { userId: session.userId } },
    select: {
      id: true, productCode: true, titleEn: true, titleBn: true, shortDescription: true, description: true, highlights: true, brand: true, modelNumber: true,
      categoryId: true, status: true, reviewNote: true, isInternationallyAvailable: true, hsCode: true, minimumOrderQuantity: true, sampleAvailable: true,
      customizationAvailable: true, productionLeadDaysMin: true, productionLeadDaysMax: true, sellingUnit: true, packageContents: true, returnPolicy: true,
      warrantyInfo: true, completenessScore: true, version: true, variants: { select: { id: true, sku: true, priceBdt: true, inventoryQuantity: true, stockStatus: true, weightGrams: true, lengthMm: true, widthMm: true, heightMm: true }, take: 1 },
      revisions: { where: { status: "PENDING_REVIEW" }, select: { id: true, status: true, submittedAt: true, baseProductVersion: true, productPayload: true, variantPayload: true, version: true }, take: 1 },
    },
  });
  if (!product) return apiError("PRODUCT_NOT_FOUND", "Product not found.", 404);
  return apiSuccess({ product }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function POST(request: NextRequest, context: RouteContext<"/api/v1/seller/products/[productId]/revisions">) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.SELLER) || session.portal !== "seller") return apiError("SELLER_ACCESS_REQUIRED", "Seller access is required.", 403);
  const parsed = submissionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Please check the product details.", 422, { fields: parsed.error.flatten().fieldErrors });

  const { productId } = await context.params;
  const seller = await prisma.sellerProfile.findUnique({ where: { userId: session.userId }, select: { id: true, status: true, shipsInternationally: true } });
  if (!seller) return apiError("SELLER_NOT_FOUND", "Seller profile not found.", 404);
  if (seller.status !== "APPROVED") return apiError("SELLER_NOT_APPROVED", "Your seller account must remain approved to submit product changes.", 403);

  const product = await prisma.product.findFirst({
    where: { id: productId, sellerProfileId: seller.id, deletedAt: null },
    select: { id: true, status: true, version: true, variants: { select: { id: true }, take: 1 } },
  });
  if (!product) return apiError("PRODUCT_NOT_FOUND", "Product not found.", 404);
  if (product.status === "PENDING_REVIEW") return apiError("INITIAL_REVIEW_PENDING", "This new product is already awaiting its first review.", 409);
  if (product.status === "ARCHIVED") return apiError("PRODUCT_ARCHIVED", "Archived products cannot be edited.", 409);
  if (product.version !== parsed.data.baseProductVersion) return apiError("PRODUCT_VERSION_CONFLICT", "This product changed in another session. Refresh and try again.", 409);
  if (!product.variants[0]) return apiError("PRODUCT_VARIANT_REQUIRED", "This product has no editable primary variant.", 409);

  const category = await prisma.category.findFirst({ where: { id: parsed.data.categoryId, isActive: true }, select: { id: true } });
  if (!category) return apiError("CATEGORY_NOT_AVAILABLE", "Choose an active product category.", 422);
  if (parsed.data.sku) {
    const conflictingSku = await prisma.productVariant.findFirst({ where: { sku: parsed.data.sku, id: { not: product.variants[0].id } }, select: { id: true } });
    if (conflictingSku) return apiError("SKU_ALREADY_USED", "This seller SKU is already assigned to another product.", 409);
  }

  const effectiveInput = { ...parsed.data, isInternationallyAvailable: seller.shipsInternationally && parsed.data.isInternationallyAvailable };
  const payload = revisionPayload(effectiveInput);
  const completenessScore = calculateProductCompleteness({ ...effectiveInput, hasPackedMeasurements: true, hasReadyMedia: false });

  try {
    const revision = await prisma.$transaction(async (tx) => {
      const existing = await tx.productRevision.findFirst({ where: { productId, status: "PENDING_REVIEW" }, select: { id: true } });
      if (existing) throw new Error("PENDING_REVISION_EXISTS");
      const created = await tx.productRevision.create({
        data: {
          productId,
          sellerProfileId: seller.id,
          baseProductVersion: product.version,
          productPayload: { ...payload.productPayload, completenessScore } as Prisma.InputJsonValue,
          variantPayload: payload.variantPayload as Prisma.InputJsonValue,
        },
        select: { id: true, productId: true, status: true, submittedAt: true, baseProductVersion: true, version: true },
      });
      await tx.auditLog.create({
        data: {
          actorId: session.userId,
          action: "seller.product_revision_submitted",
          entityType: "ProductRevision",
          entityId: created.id,
          metadata: { productId, baseProductVersion: product.version, changedBy: "SELLER", submissionMode: "MANUAL", completenessScore },
        },
      });
      return created;
    });
    return apiSuccess({ revision }, { status: 201, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    if (error instanceof Error && error.message === "PENDING_REVISION_EXISTS") return apiError("PRODUCT_REVIEW_ALREADY_PENDING", "A product change is already awaiting review.", 409);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return apiError("PRODUCT_REVIEW_ALREADY_PENDING", "A product change is already awaiting review.", 409);
    throw error;
  }
}
