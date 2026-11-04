import { type NextRequest } from "next/server";
import { z } from "zod";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";

import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { getLogisticsAccess } from "@/lib/warehouse-access";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";

const schema = z.object({
  trackingNumber: z.string().trim().min(4).max(120).transform((value) => value.toUpperCase()),
  carrierName: z.string().trim().min(2).max(120),
  originWarehouseId: z.string().uuid(),
  destinationWarehouseId: z.string().uuid(),
  packageCodes: z.array(z.string().trim().min(4).max(120)).min(1).max(100),
});

export async function POST(request: NextRequest) {
  const session = await getRequestSession(request); const access = await getLogisticsAccess(session);
  if (!session || !access) return apiError("LOGISTICS_ACCESS_REQUIRED", "Logistics portal access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "This shipment must originate from the protected Logistics application.", 403);
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
  if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 200) return apiError("IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required.", 422);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Check the carrier, warehouses, tracking number, and package codes.", 422);
  const input = parsed.data; const packageCodes = [...new Set(input.packageCodes.map((code) => code.toUpperCase()))];
  const requestHash = createHash("sha256").update(JSON.stringify({ trackingNumber: input.trackingNumber, carrierName: input.carrierName, originWarehouseId: input.originWarehouseId, destinationWarehouseId: input.destinationWarehouseId, packageCodes: [...packageCodes].sort() })).digest("hex");
  const replay = await prisma.shipmentEvent.findUnique({ where: { idempotencyKey }, select: { actorId: true, status: true, metadata: true, shipment: { select: { id: true, shipmentCode: true, trackingNumber: true, status: true, carrierName: true } } } });
  if (replay) {
    const metadata = replay.metadata && typeof replay.metadata === "object" && !Array.isArray(replay.metadata) ? replay.metadata as Record<string, unknown> : null;
    if (replay.actorId !== session.userId || replay.status !== "CREATED" || metadata?.operation !== "shipment.create" || metadata?.requestHash !== requestHash) return apiError("IDEMPOTENCY_KEY_CONFLICT", "This mutation key was already used for another shipment operation.", 409);
    return apiSuccess({ shipment: replay.shipment, idempotentReplay: true }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  }
  if (!access.isAdmin && !access.warehouseIds.includes(input.originWarehouseId)) return apiError("WAREHOUSE_NOT_ASSIGNED", "The origin warehouse is not assigned to this Logistics Worker.", 404);
  const [origin, destination, packages] = await Promise.all([
    prisma.warehouse.findUnique({ where: { id: input.originWarehouseId }, select: { id: true, name: true, country: true, type: true } }),
    prisma.warehouse.findUnique({ where: { id: input.destinationWarehouseId }, select: { id: true, name: true, country: true, type: true } }),
    prisma.package.findMany({ where: { packageCode: { in: packageCodes }, warehouseId: input.originWarehouseId }, select: { id: true, packageCode: true, status: true, isOutboundActive: true, shipmentPackages: { select: { shipmentId: true }, take: 1 }, order: { select: { id: true, status: true, originCountryCode: true, destinationCountryCode: true } } } }),
  ]);
  if (!origin || !destination) return apiError("WAREHOUSE_NOT_FOUND", "Origin or destination warehouse was not found.", 404);
  if (origin.id === destination.id || origin.type !== "ORIGIN" || destination.type !== "DESTINATION") return apiError("WAREHOUSE_ROUTE_INVALID", "Choose a configured origin warehouse and a different configured destination warehouse.", 422);
  if (packages.length !== packageCodes.length) return apiError("PACKAGE_NOT_FOUND", "Every package must exist at the assigned origin warehouse.", 404);
  if (packages.some((pkg) => !pkg.isOutboundActive || pkg.status !== "READY_TO_SHIP" || pkg.order.status !== "READY_TO_SHIP" || pkg.shipmentPackages.length)) return apiError("PACKAGE_NOT_READY", "Every package must be active, paid, ready to ship, and not already attached to a shipment.", 409);
  if (packages.some((pkg) => !pkg.order.originCountryCode || !pkg.order.destinationCountryCode || pkg.order.originCountryCode.toUpperCase() !== origin.country.toUpperCase() || pkg.order.destinationCountryCode.toUpperCase() !== destination.country.toUpperCase())) return apiError("SHIPMENT_ROUTE_MISMATCH", "Every selected package must belong to the chosen origin and destination country route.", 409);
  const duplicate = await prisma.shipment.findUnique({ where: { trackingNumber: input.trackingNumber }, select: { id: true } });
  if (duplicate) return apiError("TRACKING_NUMBER_EXISTS", "This tracking number is already registered.", 409);
  try {
    const shipment = await prisma.$transaction(async (tx) => {
      const created = await tx.shipment.create({ data: { trackingNumber: input.trackingNumber, carrierName: input.carrierName, originWarehouseId: origin.id, destinationWarehouseId: destination.id, packages: { create: packages.map((pkg) => ({ packageId: pkg.id })) }, events: { create: { status: "CREATED", actorId: session.userId, location: origin.name, description: "Shipment created from paid, ready-to-ship packages.", idempotencyKey, metadata: { operation: "shipment.create", requestHash } } } } });
      await tx.auditLog.create({ data: { actorId: session.userId, action: "logistics.shipment_created", entityType: "Shipment", entityId: created.id, metadata: { shipmentCode: created.shipmentCode, originWarehouseId: origin.id, destinationWarehouseId: destination.id, packageCount: packages.length, idempotencyKey } } });
      return created;
    });
    return apiSuccess({ shipment: { id: shipment.id, shipmentCode: shipment.shipmentCode, trackingNumber: shipment.trackingNumber, status: shipment.status, carrierName: shipment.carrierName }, idempotentReplay: false }, { status: 201, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return apiError("SHIPMENT_ASSIGNMENT_CONFLICT", "The tracking number, mutation key, or a selected package was assigned by another request. Scan the packages again.", 409);
    throw error;
  }
}
