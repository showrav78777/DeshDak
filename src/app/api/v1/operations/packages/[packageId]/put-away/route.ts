import { type NextRequest } from "next/server";
import { z } from "zod";

import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { canAccessWarehouse, getWarehouseAccess } from "@/lib/warehouse-access";

const schema = z.object({ warehouseLocationId: z.string().uuid() });

export async function POST(request: NextRequest, context: RouteContext<"/api/v1/operations/packages/[packageId]/put-away">) {
  const session = await getRequestSession(request);
  const access = await getWarehouseAccess(session);
  if (!session || !access) return apiError("WAREHOUSE_ACCESS_REQUIRED", "Warehouse portal access is required.", 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Choose a valid warehouse location.", 422);
  const { packageId } = await context.params;
  const [pkg, location] = await Promise.all([
    prisma.package.findUnique({ where: { id: packageId }, select: { id: true, packageCode: true, warehouseId: true, status: true, isOutboundActive: true } }),
    prisma.warehouseLocation.findUnique({ where: { id: parsed.data.warehouseLocationId }, select: { id: true, warehouseId: true, code: true, type: true } }),
  ]);
  if (!pkg || !pkg.isOutboundActive || !location || !canAccessWarehouse(access, pkg.warehouseId)) return apiError("PACKAGE_OR_LOCATION_NOT_FOUND", "Package or location was not found.", 404);
  if (pkg.warehouseId !== location.warehouseId) return apiError("LOCATION_WAREHOUSE_MISMATCH", "Choose a location in this package's warehouse.", 422);
  if (pkg.status !== "MEASURED") return apiError("MEASUREMENT_REQUIRED", "Measure the package before put-away.", 409);
  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.package.update({ where: { id: pkg.id }, data: { warehouseLocationId: location.id } });
    await tx.packageEvent.create({ data: { packageId: pkg.id, eventType: "PUT_AWAY", status: pkg.status, actorId: session.userId, locationCode: location.code, note: `Put away in ${location.type.toLowerCase()} ${location.code}.` } });
    await tx.auditLog.create({ data: { actorId: session.userId, action: "warehouse.package_put_away", entityType: "Package", entityId: pkg.id, metadata: { warehouseId: pkg.warehouseId, warehouseLocationId: location.id, locationCode: location.code } } });
    return saved;
  });
  return apiSuccess({ package: { packageCode: updated.packageCode, status: updated.status, warehouseLocationId: updated.warehouseLocationId }, location });
}
