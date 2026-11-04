import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { canAccessWarehouse, getWarehouseAccess } from "@/lib/warehouse-access";

export async function POST(request: NextRequest, context: RouteContext<"/api/v1/operations/packages/[packageId]/label/print-log">) {
  const session = await getRequestSession(request);
  const access = await getWarehouseAccess(session);
  if (!session || !access) return apiError("WAREHOUSE_ACCESS_REQUIRED", "Warehouse portal access is required.", 403);
  const { packageId } = await context.params;
  const pkg = await prisma.package.findUnique({ where: { id: packageId }, select: { id: true, packageCode: true, status: true, warehouseId: true, isOutboundActive: true } });
  if (!pkg || !pkg.isOutboundActive) return apiError("PACKAGE_NOT_FOUND", "Package was not found.", 404);
  if (!canAccessWarehouse(access, pkg.warehouseId)) return apiError("PACKAGE_NOT_FOUND", "Package was not found.", 404);
  if (pkg.status !== "MEASURED") return apiError("MEASUREMENT_REQUIRED", "Measure the package before printing its label.", 409);
  await prisma.$transaction([
    prisma.packageEvent.create({ data: { packageId, eventType: "LABEL_PRINTED", status: pkg.status, actorId: session.userId, note: "80 mm warehouse label printed." } }),
    prisma.auditLog.create({ data: { actorId: session.userId, action: "warehouse.label_printed", entityType: "Package", entityId: packageId, metadata: { packageCode: pkg.packageCode, widthMm: 80, format: "browser_print" } } }),
  ]);
  return apiSuccess({ logged: true });
}
