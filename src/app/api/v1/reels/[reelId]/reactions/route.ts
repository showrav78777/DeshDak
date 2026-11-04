import { Prisma } from "@prisma/client";
import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { reelReactionSchema } from "@/modules/reels/schemas";

export async function PUT(request: NextRequest, context: RouteContext<"/api/v1/reels/[reelId]/reactions">) {
  const session = await getRequestSession(request);
  if (!session) return apiError("AUTHENTICATION_REQUIRED", "Sign in to like or save a Reel.", 401);
  if (!session.roles.includes(ROLE.CUSTOMER_PERSONAL)) return apiError("CUSTOMER_ACCESS_REQUIRED", "A customer account is required.", 403);
  const parsed = reelReactionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Choose a valid Reel action.", 422);
  const { reelId } = await context.params;
  const reel = await prisma.reel.findFirst({ where: { id: reelId, status: "ACTIVE", product: { status: "ACTIVE", complianceStatus: "CLEAR", deletedAt: null }, sellerProfile: { status: "APPROVED" }, media: { status: "READY", kind: "VIDEO" } }, select: { id: true } });
  if (!reel) return apiError("REEL_NOT_FOUND", "Reel not found.", 404);
  const counter = parsed.data.type === "LIKE" ? "likeCount" : "saveCount";

  if (parsed.data.active) {
    try {
      await prisma.$transaction(async (tx) => {
        const reaction = await tx.reelReaction.create({ data: { reelId, userId: session.userId, type: parsed.data.type } });
        await tx.reel.update({ where: { id: reelId }, data: { [counter]: { increment: 1 } } });
        await tx.auditLog.create({ data: { actorId: session.userId, action: `reel.${parsed.data.type.toLowerCase()}_added`, entityType: "ReelReaction", entityId: reaction.id, metadata: { reelId } } });
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    }
  } else {
    await prisma.$transaction(async (tx) => {
      const removed = await tx.reelReaction.deleteMany({ where: { reelId, userId: session.userId, type: parsed.data.type } });
      if (!removed.count) return;
      await tx.reel.updateMany({ where: { id: reelId, [counter]: { gt: 0 } }, data: { [counter]: { decrement: 1 } } });
      await tx.auditLog.create({ data: { actorId: session.userId, action: `reel.${parsed.data.type.toLowerCase()}_removed`, entityType: "Reel", entityId: reelId } });
    });
  }
  const current = await prisma.reel.findUniqueOrThrow({ where: { id: reelId }, select: { likeCount: true, saveCount: true } });
  return apiSuccess({ active: parsed.data.active, type: parsed.data.type, counts: { likes: current.likeCount, saves: current.saveCount } }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
