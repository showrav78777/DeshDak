import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";

const schema = z.object({ status: z.enum(["ACTIVE", "PAUSED", "EXPIRED"]), version: z.number().int().positive() });

export async function PATCH(request: NextRequest, context: RouteContext<"/api/v1/admin/coupons/[couponId]">) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN)) return apiError("ADMIN_ACCESS_REQUIRED", "Administrator access is required.", 403);
  const { couponId } = await context.params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Choose a valid coupon state.", 422, z.treeifyError(parsed.error));
  const current = await prisma.coupon.findUnique({ where: { id: couponId } });
  if (!current) return apiError("COUPON_NOT_FOUND", "Coupon not found.", 404);
  if (current.status === "EXPIRED") return apiError("COUPON_TERMINAL", "An expired coupon cannot be reactivated.", 409);
  if (parsed.data.status === "ACTIVE" && current.endsAt <= new Date()) return apiError("COUPON_EXPIRED", "This coupon's validity window has already ended.", 409);

  const updated = await prisma.$transaction(async (tx) => {
    const changed = await tx.coupon.updateMany({ where: { id: couponId, version: parsed.data.version }, data: { status: parsed.data.status, version: { increment: 1 } } });
    if (changed.count !== 1) return null;
    const coupon = await tx.coupon.findUniqueOrThrow({ where: { id: couponId } });
    await tx.auditLog.create({ data: { actorId: session.userId, action: "coupon.status_changed", entityType: "Coupon", entityId: coupon.id, metadata: { fromStatus: current.status, toStatus: coupon.status, code: coupon.code, version: coupon.version } } });
    return coupon;
  });
  if (!updated) return apiError("COUPON_VERSION_CONFLICT", "This coupon changed in another session. Refresh and try again.", 409);
  return apiSuccess({ coupon: updated });
}
