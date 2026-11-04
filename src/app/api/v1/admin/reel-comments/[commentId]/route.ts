import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { reelCommentModerationSchema } from "@/modules/reels/schemas";

export async function PATCH(request: NextRequest, context: RouteContext<"/api/v1/admin/reel-comments/[commentId]">) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") return apiError("ADMIN_ACCESS_REQUIRED", "Administrator access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "Comment moderation must originate from the protected Admin application.", 403);
  const parsed = reelCommentModerationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Check the comment decision.", 422, { fields: parsed.error.flatten().fieldErrors });
  const { commentId } = await context.params;
  const current = await prisma.reelComment.findUnique({ where: { id: commentId }, select: { id: true, reelId: true, status: true, version: true } });
  if (!current) return apiError("COMMENT_NOT_FOUND", "Comment not found.", 404);
  if (current.version !== parsed.data.version) return apiError("COMMENT_VERSION_CONFLICT", "The comment changed in another session. Refresh and try again.", 409);
  const valid = current.status === "PENDING_MODERATION" ? ["PUBLISH", "REJECT"].includes(parsed.data.decision) : current.status === "PUBLISHED" && parsed.data.decision === "REMOVE";
  if (!valid) return apiError("COMMENT_STATE_CONFLICT", "This decision is not valid for the current comment state.", 409);
  const now = new Date();
  const nextStatus = parsed.data.decision === "PUBLISH" ? "PUBLISHED" : parsed.data.decision === "REJECT" ? "REJECTED" : "REMOVED";
  const changed = await prisma.$transaction(async (tx) => {
    const updated = await tx.reelComment.updateMany({ where: { id: commentId, status: current.status, version: current.version }, data: { status: nextStatus, reviewNote: parsed.data.reason || null, moderatedById: session.userId, moderatedAt: now, publishedAt: parsed.data.decision === "PUBLISH" ? now : current.status === "PUBLISHED" ? undefined : null, version: { increment: 1 } } });
    if (updated.count !== 1) return null;
    if (parsed.data.decision === "PUBLISH") await tx.reel.update({ where: { id: current.reelId }, data: { commentCount: { increment: 1 } } });
    if (parsed.data.decision === "REMOVE") await tx.reel.updateMany({ where: { id: current.reelId, commentCount: { gt: 0 } }, data: { commentCount: { decrement: 1 } } });
    await tx.auditLog.create({ data: { actorId: session.userId, action: `reel.comment_${parsed.data.decision.toLowerCase()}`, entityType: "ReelComment", entityId: commentId, metadata: { reelId: current.reelId, previousStatus: current.status, nextStatus, reason: parsed.data.reason || null, reviewedVersion: current.version } } });
    return tx.reelComment.findUniqueOrThrow({ where: { id: commentId }, select: { id: true, status: true, version: true, publishedAt: true } });
  });
  if (!changed) return apiError("COMMENT_VERSION_CONFLICT", "The comment changed in another session. Refresh and try again.", 409);
  return apiSuccess({ comment: changed }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
