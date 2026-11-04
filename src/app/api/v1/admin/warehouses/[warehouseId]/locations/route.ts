import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";

const schema = z.object({ code: z.string().trim().min(2).max(40).toUpperCase(), type: z.enum(["ZONE", "SHELF", "BIN", "STAGING"]) });

export async function POST(request: NextRequest, context: RouteContext<"/api/v1/admin/warehouses/[warehouseId]/locations">) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN)) return apiError("ADMIN_ACCESS_REQUIRED", "Admin access is required.", 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Please provide a valid location code and type.", 422);
  const { warehouseId } = await context.params;
  const warehouse = await prisma.warehouse.findUnique({ where: { id: warehouseId }, select: { id: true } });
  if (!warehouse) return apiError("WAREHOUSE_NOT_FOUND", "Warehouse was not found.", 404);
  try {
    const location = await prisma.$transaction(async (tx) => {
      const created = await tx.warehouseLocation.create({ data: { warehouseId, ...parsed.data } });
      await tx.auditLog.create({ data: { actorId: session.userId, action: "warehouse_location.created", entityType: "WarehouseLocation", entityId: created.id, metadata: { warehouseId, code: created.code, type: created.type } } });
      return created;
    });
    return apiSuccess({ location }, { status: 201 });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return apiError("LOCATION_CODE_EXISTS", "This location code already exists in the warehouse.", 409);
    throw error;
  }
}
