import { type NextRequest } from "next/server";
import { z } from "zod";

import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { createReference } from "@/lib/reference";
import { getRequestSession } from "@/lib/request-session";
import { canAccessWarehouse, getWarehouseAccess } from "@/lib/warehouse-access";
import { createTransactionalNotification } from "@/modules/notifications/service";

const packageCode = z.string().trim().toUpperCase().regex(/^PKG-[A-F0-9]{12}$/);
const schema = z.object({ warehouseNote: z.string().trim().min(10).max(1500), scannedPackageCodes: z.array(packageCode).min(1).max(10) });

export async function POST(request: NextRequest, context: RouteContext<"/api/v1/operations/package-services/[requestId]/complete">) {
  const session = await getRequestSession(request); const access = await getWarehouseAccess(session); if (!session || !access) return apiError("WAREHOUSE_ACCESS_REQUIRED", "Warehouse access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "This package operation must originate from the protected Warehouse application.", 403);
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim(); if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 200) return apiError("IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required.", 422);
  const parsed = schema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return apiError("VALIDATION_ERROR", "Describe the completed physical handling and label checks.", 422);
  const { requestId } = await context.params;
  const current = await prisma.packageServiceRequest.findUnique({ where: { id: requestId }, include: { order: { select: { id: true, orderNumber: true, status: true, customerId: true, shipForMeRequest: { select: { id: true } } } }, packages: { where: { role: "SOURCE" }, include: { package: { select: { id: true, packageCode: true, status: true, warehouseId: true, isOutboundActive: true } } } } } });
  if (!current) return apiError("PACKAGE_SERVICE_NOT_FOUND", "Package service request was not found.", 404);
  if (current.executionIdempotencyKey === idempotencyKey && current.status === "COMPLETED") { const results = await prisma.packageServicePackage.findMany({ where: { requestId: current.id, role: "RESULT" }, include: { package: { select: { id: true, packageCode: true, status: true } } } }); return apiSuccess({ request: { id: current.id, reference: current.reference, status: current.status }, resultPackages: results.map(({ package: pkg }) => pkg), idempotentReplay: true }, { headers: { "Cache-Control": "private, no-store, max-age=0" } }); }
  if (current.status !== "APPROVED") return apiError("PACKAGE_SERVICE_NOT_APPROVED", "Only an Admin-approved package service can be completed.", 409);
  const sources = current.packages.map(({ package: pkg }) => pkg); const warehouseId = sources[0]?.warehouseId;
  if (!warehouseId || !canAccessWarehouse(access, warehouseId) || sources.some((pkg) => pkg.warehouseId !== warehouseId || !pkg.isOutboundActive || !["RECEIVED", "INSPECTED", "MEASURED"].includes(pkg.status))) return apiError("PACKAGE_SERVICE_NOT_AVAILABLE", "The source packages are not active at an assigned warehouse.", 409);
  const expectedCodes = [...new Set(sources.map(({ packageCode: code }) => code.toUpperCase()))].sort();
  const scannedCodes = [...new Set(parsed.data.scannedPackageCodes)].sort();
  if (expectedCodes.length !== scannedCodes.length || expectedCodes.some((code, index) => code !== scannedCodes[index])) return apiError("SOURCE_SCAN_MISMATCH", "Scan every exact active source package code once before completing this task.", 409);
  const result = await prisma.$transaction(async (tx) => {
    const claimed = await tx.packageServiceRequest.updateMany({ where: { id: current.id, status: "APPROVED", executionIdempotencyKey: null }, data: { status: "COMPLETED", executionIdempotencyKey: idempotencyKey, warehouseNote: parsed.data.warehouseNote, completedById: session.userId, completedAt: new Date() } }); if (claimed.count !== 1) return null;
    await tx.package.updateMany({ where: { id: { in: sources.map(({ id }) => id) }, isOutboundActive: true }, data: { isOutboundActive: false } });
    const results = [];
    for (let index = 0; index < current.requestedOutputCount; index += 1) { const pkg = await tx.package.create({ data: { orderId: current.orderId, warehouseId, packageCode: createReference("PKG"), inboundCarrier: "DeshDak warehouse handling", status: "RECEIVED", events: { create: { eventType: "RECEIVED", status: "RECEIVED", actorId: session.userId, note: `${current.type.toLowerCase()} result ${index + 1} of ${current.requestedOutputCount}; awaiting fresh inspection and measurement.` } } } }); await tx.packageServicePackage.create({ data: { requestId: current.id, packageId: pkg.id, role: "RESULT" } }); results.push(pkg); }
    for (const source of sources) await tx.packageEvent.create({ data: { packageId: source.id, eventType: "NOTE_ADDED", status: source.status, actorId: session.userId, note: `Replaced as an outbound package by service ${current.reference}. Source record remains immutable and inactive.` } });
    await tx.order.update({ where: { id: current.orderId }, data: { status: "WAREHOUSE_RECEIVED", statusHistory: { create: { fromStatus: current.order.status, toStatus: "WAREHOUSE_RECEIVED", actorId: session.userId, note: `${current.reference} completed. ${results.length} replacement package${results.length === 1 ? "" : "s"} require fresh inspection and measurement.` } } } });
    await createTransactionalNotification(tx, { userId: current.customerId, eventType: "PACKAGE_SERVICE_COMPLETED", title: `Warehouse service completed · ${current.reference}`, body: `${results.length} new outbound package${results.length === 1 ? " is" : "s are"} ready for fresh inspection and measurement. No service fee was charged.`, deepLink: `/ship-for-me/${current.order.shipForMeRequest!.id}`, entityType: "PackageServiceRequest", entityId: current.id, idempotencyKey: `package-service-completed:${current.id}` });
    await tx.auditLog.create({ data: { actorId: session.userId, action: "warehouse.package_service_completed", entityType: "PackageServiceRequest", entityId: current.id, metadata: { type: current.type, sourcePackageIds: sources.map(({ id }) => id), scannedPackageCodes: scannedCodes, resultPackageIds: results.map(({ id }) => id), warehouseId } } });
    return results;
  });
  if (!result) return apiError("SERVICE_STATE_CHANGED", "This package service changed while it was being completed.", 409);
  return apiSuccess({ request: { id: current.id, reference: current.reference, status: "COMPLETED" }, resultPackages: result.map(({ id, packageCode, status }) => ({ id, packageCode, status })), idempotentReplay: false }, { status: 201, headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
