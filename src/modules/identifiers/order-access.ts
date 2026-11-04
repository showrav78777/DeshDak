import { type Prisma } from "@prisma/client";

import { type SessionPayload } from "@/lib/session";
import { ROLE } from "@/lib/roles";

export function orderCodeAccessWhere(orderNumber: string, session: SessionPayload): Prisma.OrderWhereInput | null {
  if (session.roles.includes(ROLE.ADMIN)) return { orderNumber };

  const ownership: Prisma.OrderWhereInput[] = [];
  if (session.roles.includes(ROLE.CUSTOMER_PERSONAL)) ownership.push({ customerId: session.userId });
  if (session.roles.includes(ROLE.SELLER)) ownership.push({ sellerOrders: { some: { sellerProfile: { userId: session.userId } } } });
  if (session.portal === "warehouse" && session.roles.includes(ROLE.WAREHOUSE_WORKER)) ownership.push({ packages: { some: { warehouse: { staffAssignments: { some: { userId: session.userId, isActive: true } } } } } });
  if (session.portal === "inspector" && session.roles.includes(ROLE.INSPECTOR)) ownership.push({ packages: { some: { warehouse: { staffAssignments: { some: { userId: session.userId, isActive: true } } } } } });
  if (session.portal === "logistics" && session.roles.includes(ROLE.LOGISTICS_WORKER)) ownership.push({ packages: { some: { shipmentPackages: { some: { shipment: { OR: [{ originWarehouse: { staffAssignments: { some: { userId: session.userId, isActive: true } } } }, { destinationWarehouse: { staffAssignments: { some: { userId: session.userId, isActive: true } } } }] } } } } } });
  return ownership.length ? { orderNumber, OR: ownership } : null;
}
