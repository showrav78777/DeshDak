import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { reelSellerUpdateSchema } from "@/modules/reels/schemas";

export async function PATCH(request: NextRequest, context: RouteContext<"/api/v1/seller/reels/[reelId]">) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.SELLER) || session.portal !== "seller") return apiError("SELLER_ACCESS_REQUIRED", "Seller access is required.", 403);
  const parsed = reelSellerUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Check the Reel update.", 422, { fields: parsed.error.flatten().fieldErrors });
  const { reelId } = await context.params;
  const current = await prisma.reel.findFirst({ where: { id: reelId, sellerProfile: { userId: session.userId } }, select: { id: true, status: true, version: true, product: { select: { status: true, complianceStatus: true, deletedAt: true } }, media: { select: { kind: true, status: true } } } });
  if (!current) return apiError("REEL_NOT_FOUND", "Reel not found.", 404);
  if (current.version !== parsed.data.version) return apiError("REEL_VERSION_CONFLICT", "The Reel changed in another session. Refresh and try again.", 409);
  const allowed = parsed.data.action === "ARCHIVE" ? ["ACTIVE", "REJECTED", "DRAFT"] : parsed.data.action === "RESUBMIT" ? ["REJECTED", "DRAFT"] : ["REJECTED", "DRAFT"];
  if (!allowed.includes(current.status)) return apiError("REEL_STATE_CONFLICT", "This action is not available for the current Reel state.", 409);
  if (parsed.data.action === "RESUBMIT" && (current.product.status !== "ACTIVE" || current.product.complianceStatus !== "CLEAR" || current.product.deletedAt || current.media.kind !== "VIDEO" || current.media.status !== "READY")) return apiError("REEL_CONTENT_UNAVAILABLE", "The product and video must remain approved before resubmission.", 409);
  const nextStatus = parsed.data.action === "ARCHIVE" ? "ARCHIVED" : parsed.data.action === "RESUBMIT" ? "PENDING_REVIEW" : "DRAFT";
  const changed = await prisma.$transaction(async (tx) => {
    const updated = await tx.reel.updateMany({ where: { id: reelId, status: current.status, version: current.version }, data: { caption: parsed.data.caption, status: nextStatus, reviewNote: parsed.data.action === "RESUBMIT" ? null : undefined, version: { increment: 1 } } });
    if (updated.count !== 1) return null;
    await tx.auditLog.create({ data: { actorId: session.userId, action: `reel.seller_${parsed.data.action.toLowerCase()}`, entityType: "Reel", entityId: reelId, metadata: { previousStatus: current.status, nextStatus, reviewedVersion: current.version } } });
    return tx.reel.findUniqueOrThrow({ where: { id: reelId }, select: { id: true, reelCode: true, status: true, version: true, caption: true } });
  });
  if (!changed) return apiError("REEL_VERSION_CONFLICT", "The Reel changed in another session. Refresh and try again.", 409);
  return apiSuccess({ reel: changed }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
