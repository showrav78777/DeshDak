import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { productReviewModerationSchema } from "@/modules/reviews/schemas";

export async function PATCH(request: NextRequest, context: RouteContext<"/api/v1/admin/reviews/[reviewId]">) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") return apiError("ADMIN_ACCESS_REQUIRED", "Administrator access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "Review moderation must originate from the protected Admin application.", 403);
  const parsed = productReviewModerationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Check the moderation decision.", 422, { fields: parsed.error.flatten().fieldErrors });
  const { reviewId } = await context.params;
  const current = await prisma.productReview.findUnique({ where: { id: reviewId }, select: { id: true, status: true, version: true, productId: true } });
  if (!current) return apiError("REVIEW_NOT_FOUND", "Review not found.", 404);
  const valid = current.status === "PENDING_MODERATION" ? ["PUBLISHED", "REJECTED"].includes(parsed.data.decision) : current.status === "PUBLISHED" && parsed.data.decision === "REMOVED";
  if (!valid) return apiError("REVIEW_STATE_CONFLICT", "This moderation decision is not valid for the current review state.", 409);
  if (current.version !== parsed.data.version) return apiError("REVIEW_VERSION_CONFLICT", "The review changed in another session. Refresh and try again.", 409);
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const changed = await tx.productReview.updateMany({ where: { id: reviewId, status: current.status, version: current.version }, data: { status: parsed.data.decision, moderatedAt: now, moderatedById: session.userId, publishedAt: parsed.data.decision === "PUBLISHED" ? now : current.status === "PUBLISHED" ? undefined : null, version: { increment: 1 } } });
    if (changed.count !== 1) return null;
    await tx.productReviewModeration.create({ data: { reviewId, decision: parsed.data.decision, reason: parsed.data.reason || null, moderatorId: session.userId, reviewVersion: current.version } });
    await tx.auditLog.create({ data: { actorId: session.userId, action: `product.review_${parsed.data.decision.toLowerCase()}`, entityType: "ProductReview", entityId: reviewId, metadata: { productId: current.productId, previousStatus: current.status, reason: parsed.data.reason || null, reviewedVersion: current.version } } });
    return tx.productReview.findUniqueOrThrow({ where: { id: reviewId } });
  });
  if (!result) return apiError("REVIEW_VERSION_CONFLICT", "The review changed in another session. Refresh and try again.", 409);
  return apiSuccess({ review: result }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
