import type { Prisma } from "@prisma/client";

import type { WarehouseAccess } from "@/lib/warehouse-access";

export function logisticsShipmentFilter(access: WarehouseAccess): Prisma.ShipmentWhereInput {
  if (access.isAdmin) return {};
  return { OR: [{ originWarehouseId: { in: access.warehouseIds } }, { destinationWarehouseId: { in: access.warehouseIds } }] };
}
