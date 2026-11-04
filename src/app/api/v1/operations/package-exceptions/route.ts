import { type NextRequest } from "next/server";
import { z } from "zod";

import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { createReference } from "@/lib/reference";
import { getRequestSession } from "@/lib/request-session";
import { canAccessWarehouse, getWarehouseAccess } from "@/lib/warehouse-access";
import { createTransactionalNotification } from "@/modules/notifications/service";

const schema = z.object({
  orderNumber: z.string().trim().min(4).max(80),
  warehouseId: z.string().uuid(),
  packageCode: z.string().trim().min(4).max(120).optional(),
  type: z.enum(["MISSING_EXPECTED", "EXTRA_UNEXPECTED", "TRACKING_MISMATCH", "DAMAGED_ON_ARRIVAL", "MISSING_REFERENCE", "RESTRICTED_ITEM", "OTHER"]),
  description: z.string().trim().min(10).max(1500),
});

export async function POST(request: NextRequest) {
  const session = await getRequestSession(request); const access = await getWarehouseAccess(session);
  if (!session || !access) return apiError("WAREHOUSE_ACCESS_REQUIRED", "Warehouse portal access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "This exception must originate from the protected Warehouse application.", 403);
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
  if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 200) return apiError("IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required.", 422);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Check the order, warehouse, exception type, and description.", 422);
  const replay = await prisma.packageException.findUnique({ where: { idempotencyKey }, select: { id: true, reference: true, status: true, warehouseId: true } });
  if (replay) return canAccessWarehouse(access, replay.warehouseId) ? apiSuccess({ exception: replay, idempotentReplay: true }, { headers: { "Cache-Control": "private, no-store, max-age=0" } }) : apiError("ORDER_NOT_FOUND", "The warehouse task was not found.", 404);
  if (!canAccessWarehouse(access, parsed.data.warehouseId)) return apiError("ORDER_NOT_FOUND", "The warehouse task was not found.", 404);
  const order = await prisma.order.findUnique({ where: { orderNumber: parsed.data.orderNumber }, select: { id: true, customerId: true, orderNumber: true, originCountryCode: true, status: true, shipForMeRequest: { select: { id: true } }, packages: { select: { id: true, packageCode: true, warehouseId: true } } } });
  const warehouse = await prisma.warehouse.findUnique({ where: { id: parsed.data.warehouseId }, select: { id: true, country: true, type: true } });
  if (!order || !warehouse || warehouse.type !== "ORIGIN" || (order.originCountryCode && order.originCountryCode !== warehouse.country)) return apiError("ORDER_NOT_FOUND", "The warehouse task was not found.", 404);
  const pkg = parsed.data.packageCode ? order.packages.find(({ packageCode }) => packageCode.toLowerCase() === parsed.data.packageCode?.toLowerCase()) : null;
  if (parsed.data.packageCode && (!pkg || pkg.warehouseId !== warehouse.id)) return apiError("PACKAGE_NOT_FOUND", "The package was not found at this warehouse.", 404);
  const created = await prisma.$transaction(async (tx) => {
    const exception = await tx.packageException.create({ data: { reference: createReference("PEX"), idempotencyKey, type: parsed.data.type, orderId: order.id, packageId: pkg?.id, warehouseId: warehouse.id, reportedById: session.userId, description: parsed.data.description } });
    await createTransactionalNotification(tx, { userId: order.customerId, eventType: "PACKAGE_EXCEPTION_REVIEW", title: `Parcel review opened · ${order.orderNumber}`, body: "A warehouse parcel requires operational review. We will publish a confirmed customer update after an administrator resolves it.", deepLink: order.shipForMeRequest ? `/ship-for-me/${order.shipForMeRequest.id}` : `/orders/${order.id}`, entityType: "PackageException", entityId: exception.id, priority: "HIGH", channels: ["IN_APP"], idempotencyKey: `package-exception-opened:${exception.id}` });
    await tx.auditLog.create({ data: { actorId: session.userId, action: "warehouse.package_exception_reported", entityType: "PackageException", entityId: exception.id, metadata: { orderId: order.id, packageId: pkg?.id ?? null, warehouseId: warehouse.id, type: exception.type } } });
    return exception;
  });
  return apiSuccess({ exception: { id: created.id, reference: created.reference, type: created.type, status: created.status }, idempotentReplay: false }, { status: 201, headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
