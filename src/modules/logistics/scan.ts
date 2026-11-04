import { prisma } from "@/lib/prisma";
import type { WarehouseAccess } from "@/lib/warehouse-access";
import { logisticsShipmentFilter } from "@/modules/logistics/access";
import { normalizeWarehouseScan } from "@/modules/warehouse/scan";

export { normalizeWarehouseScan as normalizeLogisticsScan };

export async function resolveLogisticsScan(rawCode: string, access: WarehouseAccess) {
  const code = normalizeWarehouseScan(rawCode);
  if (!code) return null;
  const shipment = await prisma.shipment.findFirst({
    where: { AND: [logisticsShipmentFilter(access), { OR: [
      { shipmentCode: { equals: code, mode: "insensitive" } },
      { trackingNumber: { equals: code, mode: "insensitive" } },
      { packages: { some: { package: { packageCode: { equals: code, mode: "insensitive" } } } } },
      { packages: { some: { package: { order: { orderNumber: { equals: code, mode: "insensitive" } } } } } },
    ] }] },
    select: { id: true, shipmentCode: true, trackingNumber: true, status: true, carrierName: true, originWarehouseId: true, destinationWarehouseId: true, packages: { select: { package: { select: { packageCode: true, order: { select: { orderNumber: true } } } } }, take: 20 } },
  });
  return shipment ? { shipment, normalizedCode: code, destination: `/logistics/shipments/${encodeURIComponent(shipment.trackingNumber)}` } : null;
}
