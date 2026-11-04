import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";

const schema = z.object({ status: z.enum(["ACTIVE", "PAUSED", "EXPIRED"]), version: z.number().int().positive() });

export async function PATCH(request: NextRequest, context: RouteContext<"/api/v1/admin/promotions/[promotionId]">) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN)) return apiError("ADMIN_ACCESS_REQUIRED", "Administrator access is required.", 403);
  const { promotionId } = await context.params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Choose a valid promotion state.", 422, z.treeifyError(parsed.error));
  const current = await prisma.automaticPromotion.findUnique({ where: { id: promotionId } });
  if (!current) return apiError("PROMOTION_NOT_FOUND", "Automatic promotion not found.", 404);
  if (current.status === "EXPIRED") return apiError("PROMOTION_TERMINAL", "An expired promotion cannot be reactivated.", 409);
  if (parsed.data.status === "ACTIVE" && current.endsAt <= new Date()) return apiError("PROMOTION_EXPIRED", "This promotion's validity window has already ended.", 409);
  const updated = await prisma.$transaction(async (tx) => {
    const changed = await tx.automaticPromotion.updateMany({ where: { id: promotionId, version: parsed.data.version }, data: { status: parsed.data.status, version: { increment: 1 } } });
    if (changed.count !== 1) return null;
    const promotion = await tx.automaticPromotion.findUniqueOrThrow({ where: { id: promotionId } });
    await tx.auditLog.create({ data: { actorId: session.userId, action: "automatic_promotion.status_changed", entityType: "AutomaticPromotion", entityId: promotion.id, metadata: { fromStatus: current.status, toStatus: promotion.status, name: promotion.name, version: promotion.version } } });
    return promotion;
  });
  if (!updated) return apiError("PROMOTION_VERSION_CONFLICT", "This promotion changed in another session. Refresh and try again.", 409);
  return apiSuccess({ promotion: updated });
}
