import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";

const updateCountrySchema = z.object({ isActive: z.boolean() });

export async function PATCH(request: NextRequest, context: RouteContext<"/api/v1/admin/countries/[countryId]">) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN)) return apiError("ADMIN_ACCESS_REQUIRED", "Admin access is required.", 403);
  const parsed = updateCountrySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Please provide a valid country status.", 422);
  const { countryId } = await context.params;
  const existing = await prisma.country.findUnique({ where: { id: countryId }, select: { id: true, isoCode: true, isActive: true, originLanes: { where: { isActive: true }, select: { id: true } }, destinationLanes: { where: { isActive: true }, select: { id: true } } } });
  if (!existing) return apiError("COUNTRY_NOT_FOUND", "Country configuration was not found.", 404);
  const country = await prisma.$transaction(async (tx) => {
    const updated = await tx.country.update({ where: { id: countryId }, data: { isActive: parsed.data.isActive } });
    if (!parsed.data.isActive) {
      await tx.shippingLane.updateMany({ where: { checkoutEnabled: true, OR: [{ originCountryId: countryId }, { destinationCountryId: countryId }] }, data: { checkoutEnabled: false } });
      await tx.countryPaymentMethod.updateMany({ where: { countryId, checkoutEnabled: true }, data: { checkoutEnabled: false } });
    }
    await tx.auditLog.create({ data: { actorId: session.userId, action: "country.activation_changed", entityType: "Country", entityId: countryId, metadata: { isoCode: existing.isoCode, from: existing.isActive, to: updated.isActive, activeLaneCount: existing.originLanes.length + existing.destinationLanes.length } } });
    return updated;
  });
  return apiSuccess({ country });
}
