import { type NextRequest } from "next/server";
import { z } from "zod";

import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";

const assignSchema = z.object({ email: z.string().trim().email().transform((value) => value.toLowerCase()), warehouseId: z.string().uuid(), roleCode: z.enum([ROLE.WAREHOUSE_WORKER, ROLE.INSPECTOR, ROLE.LOGISTICS_WORKER]).default(ROLE.WAREHOUSE_WORKER) });
const toggleSchema = z.object({ assignmentId: z.string().uuid(), isActive: z.boolean() });

async function requireAdmin(request: NextRequest) {
  const session = await getRequestSession(request);
  return session?.portal === "admin" && session.roles.includes(ROLE.ADMIN) ? session : null;
}

export async function POST(request: NextRequest) {
  const session = await requireAdmin(request);
  if (!session) return apiError("ADMIN_ACCESS_REQUIRED", "Administrator access is required.", 403);
  const parsed = assignSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Enter a valid employee email and warehouse.", 422);
  const [user, warehouse, role] = await Promise.all([
    prisma.user.findFirst({ where: { email: parsed.data.email, deletedAt: null, status: "ACTIVE" }, select: { id: true, fullName: true } }),
    prisma.warehouse.findUnique({ where: { id: parsed.data.warehouseId }, select: { id: true, name: true } }),
    prisma.role.findUnique({ where: { code: parsed.data.roleCode }, select: { id: true } }),
  ]);
  if (!user) return apiError("ACTIVE_EMPLOYEE_ACCOUNT_REQUIRED", "No active verified account was found for this email.", 404);
  if (!warehouse) return apiError("WAREHOUSE_NOT_FOUND", "Warehouse was not found.", 404);
  if (!role) return apiError("OPERATIONS_ROLE_NOT_CONFIGURED", "The selected operations role is not configured.", 409);
  const assignment = await prisma.$transaction(async (tx) => {
    await tx.userRole.upsert({ where: { userId_roleId: { userId: user.id, roleId: role.id } }, update: {}, create: { userId: user.id, roleId: role.id } });
    const saved = await tx.warehouseStaffAssignment.upsert({ where: { userId_warehouseId: { userId: user.id, warehouseId: warehouse.id } }, update: { isActive: true, deactivatedAt: null, assignedById: session.userId, assignedAt: new Date() }, create: { userId: user.id, warehouseId: warehouse.id, assignedById: session.userId } });
    await tx.auditLog.create({ data: { actorId: session.userId, action: "warehouse.staff_assigned", entityType: "WarehouseStaffAssignment", entityId: saved.id, metadata: { userId: user.id, warehouseId: warehouse.id, roleCode: parsed.data.roleCode } } });
    return saved;
  });
  return apiSuccess({ assignment: { id: assignment.id, workerName: user.fullName, warehouseName: warehouse.name, roleCode: parsed.data.roleCode, isActive: assignment.isActive } }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const session = await requireAdmin(request);
  if (!session) return apiError("ADMIN_ACCESS_REQUIRED", "Administrator access is required.", 403);
  const parsed = toggleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Check the assignment status.", 422);
  const existing = await prisma.warehouseStaffAssignment.findUnique({ where: { id: parsed.data.assignmentId }, select: { id: true, userId: true, warehouseId: true } });
  if (!existing) return apiError("ASSIGNMENT_NOT_FOUND", "Warehouse assignment was not found.", 404);
  const assignment = await prisma.$transaction(async (tx) => {
    const saved = await tx.warehouseStaffAssignment.update({ where: { id: existing.id }, data: { isActive: parsed.data.isActive, deactivatedAt: parsed.data.isActive ? null : new Date(), assignedById: session.userId } });
    await tx.auditLog.create({ data: { actorId: session.userId, action: parsed.data.isActive ? "warehouse.staff_activated" : "warehouse.staff_deactivated", entityType: "WarehouseStaffAssignment", entityId: saved.id, metadata: { userId: existing.userId, warehouseId: existing.warehouseId } } });
    return saved;
  });
  return apiSuccess({ assignment: { id: assignment.id, isActive: assignment.isActive } });
}
