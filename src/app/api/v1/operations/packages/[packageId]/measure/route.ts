import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { canAccessWarehouse, getWarehouseAccess } from "@/lib/warehouse-access";
import { createTransactionalNotification, orderNotification } from "@/modules/notifications/service";

const schema = z.object({ actualWeightGrams: z.coerce.number().int().positive().max(10_000_000), lengthMm: z.coerce.number().int().positive().max(100_000), widthMm: z.coerce.number().int().positive().max(100_000), heightMm: z.coerce.number().int().positive().max(100_000) });

export async function POST(request: NextRequest, context: RouteContext<"/api/v1/operations/packages/[packageId]/measure">) {
  const session = await getRequestSession(request);
  const access = await getWarehouseAccess(session);
  if (!session || !access) return apiError("WAREHOUSE_ACCESS_REQUIRED", "Warehouse portal access is required.", 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Check the measurement values.", 422);
  const { packageId } = await context.params;
  const current = await prisma.package.findUnique({ where: { id: packageId }, include: { order: { include: { sourcingRequest: { select: { sourceCountryCode: true } } } } } });
  if (!current || !current.isOutboundActive) return apiError("PACKAGE_NOT_FOUND", "Package was not found.", 404);
  if (!canAccessWarehouse(access, current.warehouseId)) return apiError("PACKAGE_NOT_FOUND", "Package was not found.", 404);
  if (current.status !== "INSPECTED" || current.qcStatus !== "PASSED" || current.order.status !== "INSPECTION") return apiError("PASSED_INSPECTION_REQUIRED", "A passed inspection is required before measurement.", 409);
  const sourceCountryCode = current.order.originCountryCode ?? current.order.sourcingRequest?.sourceCountryCode ?? "CN";
  const lane = await prisma.shippingLane.findFirst({ where: { ...(current.order.shippingLaneId ? { id: current.order.shippingLaneId } : {}), isActive: true, financeApproved: true, complianceApproved: true, operationsApproved: true, originCountry: { isoCode: sourceCountryCode } }, orderBy: { createdAt: "asc" }, select: { dimensionalWeightDivisor: true, name: true } });
  if (!lane) return apiError("ACTIVE_SHIPPING_LANE_REQUIRED", "Configure and enable the source-country shipping lane before measurement.", 409);
  const volumetric = Math.ceil((parsed.data.lengthMm * parsed.data.widthMm * parsed.data.heightMm) / lane.dimensionalWeightDivisor);
  const chargeable = Math.max(parsed.data.actualWeightGrams, volumetric);
  const pkg = await prisma.$transaction(async (tx) => {
    const updated = await tx.package.update({ where: { id: packageId }, data: { actualWeightGrams: parsed.data.actualWeightGrams, lengthMm: parsed.data.lengthMm, widthMm: parsed.data.widthMm, heightMm: parsed.data.heightMm, volumetricWeightGrams: volumetric, chargeableWeightGrams: chargeable, status: "MEASURED" } });
    await tx.packageEvent.create({ data: { packageId, eventType: "MEASURED", status: "MEASURED", actorId: session.userId, note: `Actual ${parsed.data.actualWeightGrams}g; volumetric ${volumetric}g; chargeable ${chargeable}g.`, metadata: { ...parsed.data, volumetricWeightGrams: volumetric, chargeableWeightGrams: chargeable, dimensionalWeightDivisor: lane.dimensionalWeightDivisor } } });
    const note = `Package ${current.packageCode} measured: actual ${parsed.data.actualWeightGrams}g, volumetric ${volumetric}g, chargeable ${chargeable}g using ${lane.name}.`;
    const unmeasuredPackages = await tx.package.count({ where: { orderId: current.orderId, isOutboundActive: true, status: { not: "MEASURED" } } });
    if (unmeasuredPackages === 0) {
      await tx.order.update({ where: { id: current.orderId }, data: { status: "MEASURED" } });
      const history = await tx.orderStatusHistory.create({ data: { orderId: current.orderId, fromStatus: current.order.status, toStatus: "MEASURED", actorId: session.userId, note: `All packages measured. ${note}` } });
      const notification = orderNotification({ userId: current.order.customerId, orderId: current.orderId, orderNumber: current.order.orderNumber, status: "MEASURED", eventId: history.id });
      if (notification) await createTransactionalNotification(tx, notification);
    }
    await tx.auditLog.create({ data: { actorId: session.userId, action: "warehouse.package_measured", entityType: "Package", entityId: packageId, metadata: { ...parsed.data, volumetricWeightGrams: volumetric, chargeableWeightGrams: chargeable, dimensionalWeightDivisor: lane.dimensionalWeightDivisor } } });
    return updated;
  });
  return apiSuccess({ package: pkg });
}
