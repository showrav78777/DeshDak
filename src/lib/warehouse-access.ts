import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { type SessionPayload } from "@/lib/session";

export type WarehouseAccess = { isAdmin: boolean; warehouseIds: string[] };

async function getAssignedOperationsAccess(session: SessionPayload | null, portal: string, role: string): Promise<WarehouseAccess | null> {
  if (!session) return null;
  if (session.portal === "admin" && session.roles.includes(ROLE.ADMIN)) return { isAdmin: true, warehouseIds: [] };
  if (session.portal !== portal || !session.roles.includes(role)) return null;
  const assignments = await prisma.warehouseStaffAssignment.findMany({
    where: { userId: session.userId, isActive: true },
    select: { warehouseId: true },
  });
  return { isAdmin: false, warehouseIds: assignments.map(({ warehouseId }) => warehouseId) };
}

export function getWarehouseAccess(session: SessionPayload | null) {
  return getAssignedOperationsAccess(session, "warehouse", ROLE.WAREHOUSE_WORKER);
}

export function getInspectorAccess(session: SessionPayload | null) {
  return getAssignedOperationsAccess(session, "inspector", ROLE.INSPECTOR);
}

export function getLogisticsAccess(session: SessionPayload | null) {
  return getAssignedOperationsAccess(session, "logistics", ROLE.LOGISTICS_WORKER);
}

export function canAccessWarehouse(access: WarehouseAccess, warehouseId: string | null) {
  return access.isAdmin || Boolean(warehouseId && access.warehouseIds.includes(warehouseId));
}

export function warehouseIdFilter(access: WarehouseAccess) {
  return access.isAdmin ? undefined : { in: access.warehouseIds };
}
