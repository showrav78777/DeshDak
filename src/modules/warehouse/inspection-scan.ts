import { type Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { type WarehouseAccess, warehouseIdFilter } from "@/lib/warehouse-access";
import { normalizeWarehouseScan } from "@/modules/warehouse/scan";

export { normalizeWarehouseScan as normalizeInspectionScan };

export async function resolveInspectionScan(rawCode: string, access: WarehouseAccess) {
  const code = normalizeWarehouseScan(rawCode);
  if (!code) return null;
  const warehouseId = warehouseIdFilter(access);
  const where: Prisma.PackageWhereInput = {
    ...(warehouseId ? { warehouseId } : {}),
    isOutboundActive: true,
    status: { in: ["RECEIVED", "INSPECTED"] },
    OR: [
      { packageCode: { equals: code, mode: "insensitive" } },
      { inboundTracking: { equals: code, mode: "insensitive" } },
      { order: { orderNumber: { equals: code, mode: "insensitive" } } },
    ],
  };
  const pkg = await prisma.package.findFirst({ where, select: { id: true, packageCode: true, status: true, qcStatus: true, warehouseId: true, order: { select: { orderNumber: true } } } });
  return pkg ? { package: pkg, normalizedCode: code, destination: `/inspector/packages/${encodeURIComponent(pkg.packageCode)}` } : null;
}
