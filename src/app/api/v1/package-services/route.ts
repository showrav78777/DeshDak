import { type NextRequest } from "next/server";
import { z } from "zod";

import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { createReference } from "@/lib/reference";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { createTransactionalNotification } from "@/modules/notifications/service";

const schema = z.object({ orderId: z.string().uuid(), type: z.enum(["CONSOLIDATE", "SPLIT", "REPACK"]), packageIds: z.array(z.string().uuid()).min(1).max(10), requestedOutputCount: z.coerce.number().int().min(1).max(10), customerNote: z.string().trim().max(1000).optional() });

export async function GET(request: NextRequest) {
  const session = await getRequestSession(request); if (!session?.roles.includes(ROLE.CUSTOMER_PERSONAL)) return apiError("CUSTOMER_ACCESS_REQUIRED", "Customer access is required.", 403);
  const requests = await prisma.packageServiceRequest.findMany({ where: { customerId: session.userId }, include: { packages: { include: { package: { select: { packageCode: true, status: true, isOutboundActive: true } } } }, order: { select: { orderNumber: true } } }, orderBy: { createdAt: "desc" }, take: 50 });
  return apiSuccess({ requests }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function POST(request: NextRequest) {
  const session = await getRequestSession(request); if (!session?.roles.includes(ROLE.CUSTOMER_PERSONAL)) return apiError("CUSTOMER_ACCESS_REQUIRED", "Customer access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "This service request must originate from the protected customer application.", 403);
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim(); if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 200) return apiError("IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required.", 422);
  const parsed = schema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return apiError("VALIDATION_ERROR", "Check the service type, packages, and requested output count.", 422);
  const packageIds = [...new Set(parsed.data.packageIds)];
  if (parsed.data.type === "CONSOLIDATE" && (packageIds.length < 2 || parsed.data.requestedOutputCount !== 1)) return apiError("SERVICE_CONFIGURATION_INVALID", "Consolidation requires at least two source packages and one output package.", 422);
  if (parsed.data.type === "SPLIT" && (packageIds.length !== 1 || parsed.data.requestedOutputCount < 2)) return apiError("SERVICE_CONFIGURATION_INVALID", "Splitting requires one source package and at least two output packages.", 422);
  if (parsed.data.type === "REPACK" && (packageIds.length !== 1 || parsed.data.requestedOutputCount !== 1)) return apiError("SERVICE_CONFIGURATION_INVALID", "Repacking requires one source package and one output package.", 422);
  const result = await prisma.$transaction(async (tx) => {
    const replay = await tx.packageServiceRequest.findUnique({ where: { idempotencyKey }, include: { order: { select: { customerId: true } } } }); if (replay) return replay.order.customerId === session.userId ? { value: replay, replay: true } : null;
    const order = await tx.order.findFirst({ where: { id: parsed.data.orderId, customerId: session.userId, type: "SHIP_FOR_ME", status: { in: ["WAREHOUSE_RECEIVED", "INSPECTION", "MEASURED"] }, shippingQuotes: { none: { status: { in: ["SENT", "ACCEPTED", "PAID"] } } }, packageExceptions: { none: { status: "OPEN" } }, packageServiceRequests: { none: { status: { in: ["REQUESTED", "APPROVED"] } } } }, include: { shipForMeRequest: { select: { id: true } }, packages: { where: { id: { in: packageIds }, isOutboundActive: true }, select: { id: true, warehouseId: true, status: true } } } });
    if (!order || order.packages.length !== packageIds.length || order.packages.some((pkg) => !pkg.warehouseId || !["RECEIVED", "INSPECTED", "MEASURED"].includes(pkg.status)) || new Set(order.packages.map(({ warehouseId }) => warehouseId)).size !== 1) return null;
    const created = await tx.packageServiceRequest.create({ data: { reference: createReference("PSR"), idempotencyKey, orderId: order.id, customerId: session.userId, type: parsed.data.type, requestedOutputCount: parsed.data.requestedOutputCount, customerNote: parsed.data.customerNote || null, packages: { create: packageIds.map((packageId) => ({ packageId, role: "SOURCE" })) } } });
    await createTransactionalNotification(tx, { userId: session.userId, eventType: "PACKAGE_SERVICE_REQUESTED", title: `Warehouse service requested · ${created.reference}`, body: "An administrator will review the requested package handling before warehouse work begins. No fee has been charged.", deepLink: `/ship-for-me/${order.shipForMeRequest!.id}`, entityType: "PackageServiceRequest", entityId: created.id, idempotencyKey: `package-service-requested:${created.id}` });
    await tx.auditLog.create({ data: { actorId: session.userId, action: "customer.package_service_requested", entityType: "PackageServiceRequest", entityId: created.id, metadata: { orderId: order.id, type: created.type, sourceCount: packageIds.length, requestedOutputCount: created.requestedOutputCount } } });
    return { value: created, replay: false };
  });
  if (!result) return apiError("PACKAGE_SERVICE_NOT_AVAILABLE", "These packages are not available for this warehouse service.", 409);
  return apiSuccess({ request: { id: result.value.id, reference: result.value.reference, type: result.value.type, status: result.value.status }, idempotentReplay: result.replay }, { status: result.replay ? 200 : 201, headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
