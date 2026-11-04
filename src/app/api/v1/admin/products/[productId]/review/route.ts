import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { screenRestrictedGoods } from "@/modules/compliance/restricted-goods";

const schema = z.object({
  decision: z.enum(["ACTIVE", "REJECTED"]),
  reviewNote: z.string().trim().min(3).max(500),
  categoryId: z.string().uuid().optional(),
});

export async function PATCH(request: NextRequest, context: RouteContext<"/api/v1/admin/products/[productId]/review">) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") return apiError("ADMIN_ACCESS_REQUIRED", "Admin access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "Product review must originate from the protected Admin application.", 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "A decision and review note are required.", 422);

  const { productId } = await context.params;
  const product = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null, status: "PENDING_REVIEW", sellerProfileId: { not: null } },
    select: {
      id: true,
      titleEn: true,
      titleBn: true,
      shortDescription: true,
      description: true,
      brand: true,
      hsCode: true,
      originCountryCode: true,
      isInternationallyAvailable: true,
      category: { select: { id: true, isActive: true, nameEn: true, nameBn: true } },
      sellerProfile: { select: { status: true, userId: true } },
      variants: { select: { inventoryQuantity: true, weightGrams: true, lengthMm: true, widthMm: true, heightMm: true }, take: 1 },
    },
  });
  if (!product) return apiError("PRODUCT_NOT_REVIEWABLE", "Product is not awaiting seller-product review.", 409);
  if (parsed.data.decision === "ACTIVE" && product.sellerProfile?.status !== "APPROVED") return apiError("SELLER_NOT_APPROVED", "The seller must remain approved before this product can be activated.", 409);

  const selectedCategory = parsed.data.categoryId
    ? await prisma.category.findFirst({ where: { id: parsed.data.categoryId, isActive: true }, select: { id: true, nameEn: true, nameBn: true } })
    : product.category?.isActive ? product.category : null;
  if (parsed.data.categoryId && !selectedCategory) return apiError("CATEGORY_NOT_AVAILABLE", "Choose an active product category.", 422);
  if (parsed.data.decision === "ACTIVE" && !selectedCategory) return apiError("ACTIVE_CATEGORY_REQUIRED", "Assign an active category before approving this product.", 409);

  const variant = product.variants[0];
  if (parsed.data.decision === "ACTIVE" && product.originCountryCode === "BD" && product.isInternationallyAvailable && (!variant || variant.inventoryQuantity === null || !variant.weightGrams || !variant.lengthMm || !variant.widthMm || !variant.heightMm)) {
    return apiError("EXPORT_DETAILS_REQUIRED", "Inventory, packed weight, and packed dimensions are required before international approval.", 409);
  }

  const result = await prisma.$transaction(async (tx) => {
    let complianceRuleCodes: string[] = [];
    if (parsed.data.decision === "ACTIVE") {
      const compliance = await screenRestrictedGoods(tx, { subject: "PRODUCT_PUBLICATION", subjectReference: product.id, customerId: product.sellerProfile!.userId, originCountryCode: product.originCountryCode, text: [product.titleEn, product.titleBn, product.shortDescription, product.description, product.brand, selectedCategory?.nameEn, selectedCategory?.nameBn], hsCodes: [product.hsCode] });
      if (!compliance.allowed) {
        await tx.auditLog.create({ data: { actorId: session.userId, action: compliance.outcome === "BLOCKED" ? "compliance.product_publication_blocked" : "compliance.product_publication_review_required", entityType: "ComplianceScreeningAttempt", entityId: compliance.attempt.id, metadata: { productId: product.id, matchedRuleCodes: compliance.attempt.matchedRuleCodes } } });
        return { compliance, product: null };
      }
      complianceRuleCodes = compliance.attempt.matchedRuleCodes;
    }
    const reviewed = await tx.product.update({
      where: { id: productId },
      data: { status: parsed.data.decision, reviewNote: parsed.data.reviewNote, reviewedAt: new Date(), version: { increment: 1 }, ...(parsed.data.decision === "ACTIVE" ? { complianceStatus: "CLEAR" as const, complianceRuleCodes, complianceScreenedAt: new Date() } : {}), ...(selectedCategory ? { categoryId: selectedCategory.id } : {}) },
      select: { id: true, titleEn: true, status: true, reviewNote: true },
    });
    await tx.auditLog.create({
      data: {
        actorId: session.userId,
        action: `seller_product.${parsed.data.decision.toLowerCase()}`,
        entityType: "Product",
        entityId: productId,
        metadata: { reviewNote: parsed.data.reviewNote, categoryId: selectedCategory?.id ?? null, originCountryCode: product.originCountryCode, international: product.isInternationallyAvailable },
      },
    });
    return { product: reviewed };
  });
  if ("compliance" in result && result.compliance) return apiError(result.compliance.outcome === "BLOCKED" ? "RESTRICTED_GOODS_BLOCKED" : "COMPLIANCE_REVIEW_REQUIRED", result.compliance.customerMessage ?? "This product cannot be published until a compliance review is completed.", result.compliance.outcome === "BLOCKED" ? 422 : 409, { screeningReference: result.compliance.attempt.id });
  return apiSuccess({ product: result.product });
}
