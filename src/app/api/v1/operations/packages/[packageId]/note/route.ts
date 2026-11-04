import { type NextRequest } from "next/server";
import { z } from "zod";

import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { canAccessWarehouse, getWarehouseAccess } from "@/lib/warehouse-access";

const schema = z.object({ note: z.string().trim().min(2).max(500) });

export async function POST(request: NextRequest, context: RouteContext<"/api/v1/operations/packages/[packageId]/note">) {
  const session = await getRequestSession(request);
  const access = await getWarehouseAccess(session);
  if (!session || !access) return apiError("WAREHOUSE_ACCESS_REQUIRED", "Warehouse portal access is required.", 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Enter a short operational note.", 422);
  const { packageId } = await context.params;
  const pkg = await prisma.package.findUnique({ where: { id: packageId }, select: { id: true, status: true, warehouseId: true, isOutboundActive: true } });
  if (!pkg || !pkg.isOutboundActive || !canAccessWarehouse(access, pkg.warehouseId)) return apiError("PACKAGE_NOT_FOUND", "Package was not found.", 404);
  const event = await prisma.$transaction(async (tx) => {
    const created = await tx.packageEvent.create({ data: { packageId: pkg.id, eventType: "NOTE_ADDED", status: pkg.status, actorId: session.userId, note: parsed.data.note } });
    await tx.auditLog.create({ data: { actorId: session.userId, action: "warehouse.package_note_added", entityType: "Package", entityId: pkg.id, metadata: { packageEventId: created.id } } });
    return created;
  });
  return apiSuccess({ event: { id: event.id, eventType: event.eventType, status: event.status, note: event.note, occurredAt: event.occurredAt } }, { status: 201 });
}
