import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { reelModerationSchema } from "@/modules/reels/schemas";

export async function PATCH(request: NextRequest, context: RouteContext<"/api/v1/admin/reels/[reelId]">) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") return apiError("ADMIN_ACCESS_REQUIRED", "Administrator access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "Reel moderation must originate from the protected Admin application.", 403);
  const parsed = reelModerationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Check the moderation decision.", 422, { fields: parsed.error.flatten().fieldErrors });
  const { reelId } = await context.params;
  const current = await prisma.reel.findUnique({ where: { id: reelId }, select: { id: true, reelCode: true, status: true, version: true, productId: true, product: { select: { status: true, complianceStatus: true, deletedAt: true } }, sellerProfile: { select: { status: true } }, media: { select: { status: true, kind: true } } } });
  if (!current) return apiError("REEL_NOT_FOUND", "Reel not found.", 404);
  if (current.version !== parsed.data.version) return apiError("REEL_VERSION_CONFLICT", "The Reel changed in another session. Refresh and try again.", 409);
  const valid = current.status === "PENDING_REVIEW" ? ["PUBLISH", "REJECT"].includes(parsed.data.decision) : current.status === "ACTIVE" && parsed.data.decision === "ARCHIVE";
  if (!valid) return apiError("REEL_STATE_CONFLICT", "This decision is not valid for the current Reel state.", 409);
  if (parsed.data.decision === "PUBLISH" && (current.product.status !== "ACTIVE" || current.product.complianceStatus !== "CLEAR" || current.product.deletedAt || current.sellerProfile.status !== "APPROVED" || current.media.status !== "READY" || current.media.kind !== "VIDEO")) return apiError("REEL_CONTENT_UNAVAILABLE", "The seller, product, and video must all be approved before publication.", 409);
  const now = new Date();
  const nextStatus = parsed.data.decision === "PUBLISH" ? "ACTIVE" : parsed.data.decision === "REJECT" ? "REJECTED" : "ARCHIVED";
  const changed = await prisma.$transaction(async (tx) => {
    const updated = await tx.reel.updateMany({ where: { id: reelId, status: current.status, version: current.version }, data: { status: nextStatus, reviewNote: parsed.data.reason || null, moderatedById: session.userId, moderatedAt: now, publishedAt: parsed.data.decision === "PUBLISH" ? now : current.status === "ACTIVE" ? undefined : null, version: { increment: 1 } } });
    if (updated.count !== 1) return null;
    await tx.auditLog.create({ data: { actorId: session.userId, action: `reel.${parsed.data.decision.toLowerCase()}`, entityType: "Reel", entityId: reelId, metadata: { reelCode: current.reelCode, productId: current.productId, previousStatus: current.status, nextStatus, reason: parsed.data.reason || null, reviewedVersion: current.version } } });
    return tx.reel.findUniqueOrThrow({ where: { id: reelId }, select: { id: true, reelCode: true, status: true, version: true, publishedAt: true } });
  });
  if (!changed) return apiError("REEL_VERSION_CONFLICT", "The Reel changed in another session. Refresh and try again.", 409);
  return apiSuccess({ reel: changed }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
