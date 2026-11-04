import { Prisma } from "@prisma/client";
import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { sellerProductInputSchema } from "@/modules/catalog/seller-product-input";
import { screenRestrictedGoods } from "@/modules/compliance/restricted-goods";

const reviewSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  reviewNote: z.string().trim().min(3).max(500),
  version: z.number().int().positive(),
});

function record(value: Prisma.JsonValue): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function nullableText(value: unknown) {
  return typeof value === "string" ? value : "";
}

export async function PATCH(request: NextRequest, context: RouteContext<"/api/v1/admin/product-revisions/[revisionId]/review">) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") return apiError("ADMIN_ACCESS_REQUIRED", "Admin access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "Product review must originate from the protected Admin application.", 403);
  const parsed = reviewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "A valid decision, note, and revision version are required.", 422);

  const { revisionId } = await context.params;
  const revision = await prisma.productRevision.findUnique({
    where: { id: revisionId },
    select: {
      id: true, productId: true, sellerProfileId: true, status: true, version: true, baseProductVersion: true, productPayload: true, variantPayload: true,
      sellerProfile: { select: { status: true, shipsInternationally: true, userId: true } },
      product: { select: { id: true, version: true, deletedAt: true, variants: { select: { id: true }, take: 1 } } },
    },
  });
  if (!revision || revision.status !== "PENDING_REVIEW") return apiError("REVISION_NOT_REVIEWABLE", "This product change is no longer awaiting review.", 409);
  if (revision.version !== parsed.data.version) return apiError("REVISION_VERSION_CONFLICT", "This product change was reviewed in another session. Refresh and try again.", 409);

  if (parsed.data.decision === "REJECTED") {
    const rejected = await prisma.$transaction(async (tx) => {
      const changed = await tx.productRevision.updateMany({
        where: { id: revision.id, status: "PENDING_REVIEW", version: revision.version },
        data: { status: "REJECTED", reviewNote: parsed.data.reviewNote, reviewerId: session.userId, reviewedAt: new Date(), version: { increment: 1 } },
      });
      if (changed.count !== 1) throw new Error("REVISION_CONFLICT");
      await tx.auditLog.create({ data: { actorId: session.userId, action: "seller.product_revision_rejected", entityType: "ProductRevision", entityId: revision.id, metadata: { productId: revision.productId, reviewNote: parsed.data.reviewNote, baseProductVersion: revision.baseProductVersion } } });
      return tx.productRevision.findUniqueOrThrow({ where: { id: revision.id }, select: { id: true, productId: true, status: true, reviewNote: true, version: true } });
    }).catch((error: unknown) => error instanceof Error && error.message === "REVISION_CONFLICT" ? null : Promise.reject(error));
    if (!rejected) return apiError("REVISION_VERSION_CONFLICT", "This product change was reviewed in another session. Refresh and try again.", 409);
    return apiSuccess({ revision: rejected }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  }

  if (revision.sellerProfile.status !== "APPROVED") return apiError("SELLER_NOT_APPROVED", "The seller must remain approved before changes can be published.", 409);
  if (revision.product.deletedAt) return apiError("PRODUCT_NOT_AVAILABLE", "The product is no longer available.", 409);
  if (revision.product.version !== revision.baseProductVersion) return apiError("PRODUCT_VERSION_CONFLICT", "The live product changed after this submission. Reject this revision and ask the seller to submit again.", 409);
  const primaryVariant = revision.product.variants[0];
  if (!primaryVariant) return apiError("PRODUCT_VARIANT_REQUIRED", "The product has no primary variant to update.", 409);

  const productPayload = record(revision.productPayload);
  const variantPayload = record(revision.variantPayload);
  if (!productPayload || !variantPayload) return apiError("REVISION_PAYLOAD_INVALID", "The stored revision payload is invalid and cannot be published.", 409);
  const normalized = sellerProductInputSchema.safeParse({
    ...productPayload,
    ...variantPayload,
    titleBn: nullableText(productPayload.titleBn),
    brand: nullableText(productPayload.brand),
    modelNumber: nullableText(productPayload.modelNumber),
    hsCode: nullableText(productPayload.hsCode),
    returnPolicy: nullableText(productPayload.returnPolicy),
    warrantyInfo: nullableText(productPayload.warrantyInfo),
  });
  if (!normalized.success) return apiError("REVISION_PAYLOAD_INVALID", "The stored revision no longer satisfies catalog rules.", 409);
  const category = await prisma.category.findFirst({ where: { id: normalized.data.categoryId, isActive: true }, select: { id: true, nameEn: true, nameBn: true } });
  if (!category) return apiError("CATEGORY_NOT_AVAILABLE", "The selected category is no longer active.", 409);
  if (normalized.data.sku) {
    const conflictingSku = await prisma.productVariant.findFirst({ where: { sku: normalized.data.sku, id: { not: primaryVariant.id } }, select: { id: true } });
    if (conflictingSku) return apiError("SKU_ALREADY_USED", "The requested seller SKU is now used by another product.", 409);
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const compliance = await screenRestrictedGoods(tx, { subject: "PRODUCT_PUBLICATION", subjectReference: revision.productId, customerId: revision.sellerProfile.userId, originCountryCode: "BD", text: [normalized.data.titleEn, normalized.data.titleBn, normalized.data.shortDescription, normalized.data.description, normalized.data.brand, category.nameEn, category.nameBn], hsCodes: [normalized.data.hsCode] });
      if (!compliance.allowed) {
        await tx.auditLog.create({ data: { actorId: session.userId, action: compliance.outcome === "BLOCKED" ? "compliance.product_revision_blocked" : "compliance.product_revision_review_required", entityType: "ComplianceScreeningAttempt", entityId: compliance.attempt.id, metadata: { productId: revision.productId, revisionId: revision.id, matchedRuleCodes: compliance.attempt.matchedRuleCodes } } });
        return { compliance, revision: null };
      }
      const complianceRuleCodes = compliance.attempt.matchedRuleCodes;
      const claimed = await tx.productRevision.updateMany({
        where: { id: revision.id, status: "PENDING_REVIEW", version: revision.version },
        data: { status: "APPROVED", reviewNote: parsed.data.reviewNote, reviewerId: session.userId, reviewedAt: new Date(), version: { increment: 1 } },
      });
      if (claimed.count !== 1) throw new Error("REVISION_CONFLICT");
      const productUpdated = await tx.product.updateMany({
        where: { id: revision.productId, sellerProfileId: revision.sellerProfileId, version: revision.baseProductVersion, deletedAt: null },
        data: {
          titleEn: normalized.data.titleEn, titleBn: normalized.data.titleBn || null, shortDescription: normalized.data.shortDescription,
          description: normalized.data.description, highlights: normalized.data.highlights, brand: normalized.data.brand || null,
          modelNumber: normalized.data.modelNumber || null, categoryId: category.id, isInternationallyAvailable: revision.sellerProfile.shipsInternationally && normalized.data.isInternationallyAvailable,
          hsCode: normalized.data.hsCode || null, minimumOrderQuantity: normalized.data.minimumOrderQuantity, sampleAvailable: normalized.data.sampleAvailable,
          customizationAvailable: normalized.data.customizationAvailable, productionLeadDaysMin: normalized.data.productionLeadDaysMin,
          productionLeadDaysMax: normalized.data.productionLeadDaysMax, sellingUnit: normalized.data.sellingUnit, packageContents: normalized.data.packageContents,
          returnPolicy: normalized.data.returnPolicy || null, warrantyInfo: normalized.data.warrantyInfo || null,
          completenessScore: Number(productPayload.completenessScore) || 0, status: "ACTIVE", reviewNote: parsed.data.reviewNote, reviewedAt: new Date(), version: { increment: 1 },
          complianceStatus: "CLEAR", complianceRuleCodes, complianceScreenedAt: new Date(),
        },
      });
      if (productUpdated.count !== 1) throw new Error("PRODUCT_CONFLICT");
      await tx.productVariant.update({
        where: { id: primaryVariant.id },
        data: { sku: normalized.data.sku || null, priceBdt: normalized.data.priceBdt, inventoryQuantity: normalized.data.inventoryQuantity, stockStatus: normalized.data.stockStatus, weightGrams: normalized.data.weightGrams, lengthMm: normalized.data.lengthMm, widthMm: normalized.data.widthMm, heightMm: normalized.data.heightMm },
      });
      await tx.auditLog.create({ data: { actorId: session.userId, action: "seller.product_revision_approved", entityType: "ProductRevision", entityId: revision.id, metadata: { productId: revision.productId, reviewNote: parsed.data.reviewNote, fromProductVersion: revision.baseProductVersion, toProductVersion: revision.baseProductVersion + 1, changedFields: [...Object.keys(productPayload), ...Object.keys(variantPayload)] } } });
      return { revision: await tx.productRevision.findUniqueOrThrow({ where: { id: revision.id }, select: { id: true, productId: true, status: true, reviewNote: true, version: true } }) };
    });
    if ("compliance" in result && result.compliance) return apiError(result.compliance.outcome === "BLOCKED" ? "RESTRICTED_GOODS_BLOCKED" : "COMPLIANCE_REVIEW_REQUIRED", result.compliance.customerMessage ?? "These product changes cannot be published until a compliance review is completed.", result.compliance.outcome === "BLOCKED" ? 422 : 409, { screeningReference: result.compliance.attempt.id });
    return apiSuccess({ revision: result.revision }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    if (error instanceof Error && (error.message === "REVISION_CONFLICT" || error.message === "PRODUCT_CONFLICT")) return apiError("REVISION_VERSION_CONFLICT", "This product or revision changed in another session. Refresh and try again.", 409);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return apiError("SKU_ALREADY_USED", "The requested seller SKU is now used by another product.", 409);
    throw error;
  }
}
