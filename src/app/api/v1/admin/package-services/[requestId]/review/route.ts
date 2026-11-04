import { type NextRequest } from "next/server";
import { z } from "zod";

import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { createTransactionalNotification } from "@/modules/notifications/service";

const schema = z.object({ action: z.enum(["APPROVED", "REJECTED"]), adminNote: z.string().trim().min(10).max(1500), customerNote: z.string().trim().min(3).max(500) });

export async function POST(request: NextRequest, context: RouteContext<"/api/v1/admin/package-services/[requestId]/review">) {
  const session = await getRequestSession(request); if (!session?.roles.includes(ROLE.ADMIN)) return apiError("ADMIN_ACCESS_REQUIRED", "Admin access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "This decision must originate from the protected Admin application.", 403);
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim(); if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 200) return apiError("IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required.", 422);
  const parsed = schema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return apiError("VALIDATION_ERROR", "Provide the decision, internal reason, and customer-safe update.", 422);
  const { requestId } = await context.params;
  const current = await prisma.packageServiceRequest.findUnique({ where: { id: requestId }, include: { order: { select: { id: true, orderNumber: true, status: true, shipForMeRequest: { select: { id: true } }, packageExceptions: { where: { status: "OPEN" }, select: { id: true }, take: 1 }, shippingQuotes: { where: { status: { in: ["SENT", "ACCEPTED", "PAID"] } }, select: { id: true }, take: 1 } } }, packages: { where: { role: "SOURCE" }, include: { package: { select: { isOutboundActive: true, status: true, warehouseId: true } } } } } });
  if (!current) return apiError("PACKAGE_SERVICE_NOT_FOUND", "Package service request was not found.", 404);
  if (current.status !== "REQUESTED") return apiSuccess({ request: { id: current.id, reference: current.reference, status: current.status }, idempotentReplay: true }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  if (parsed.data.action === "APPROVED") {
    const sources = current.packages.map(({ package: pkg }) => pkg);
    if (!sources.length || current.order.packageExceptions.length || current.order.shippingQuotes.length || !["WAREHOUSE_RECEIVED", "INSPECTION", "MEASURED"].includes(current.order.status) || sources.some((pkg) => !pkg.isOutboundActive || !pkg.warehouseId || !["RECEIVED", "INSPECTED", "MEASURED"].includes(pkg.status)) || new Set(sources.map(({ warehouseId }) => warehouseId)).size !== 1) return apiError("PACKAGE_SERVICE_NOT_AVAILABLE", "The order or source packages changed and this request can no longer be approved.", 409);
  }
  const reviewed = await prisma.$transaction(async (tx) => {
    const claimed = await tx.packageServiceRequest.updateMany({ where: { id: current.id, status: "REQUESTED" }, data: { status: parsed.data.action, adminNote: parsed.data.adminNote, reviewCustomerNote: parsed.data.customerNote, reviewedById: session.userId, reviewedAt: new Date() } }); if (claimed.count !== 1) return null;
    await createTransactionalNotification(tx, { userId: current.customerId, eventType: `PACKAGE_SERVICE_${parsed.data.action}`, title: `Warehouse service ${parsed.data.action.toLowerCase()} · ${current.reference}`, body: parsed.data.customerNote, deepLink: `/ship-for-me/${current.order.shipForMeRequest!.id}`, entityType: "PackageServiceRequest", entityId: current.id, priority: parsed.data.action === "REJECTED" ? "HIGH" : "NORMAL", channels: ["IN_APP"], idempotencyKey: `package-service-review:${current.id}` });
    await tx.auditLog.create({ data: { actorId: session.userId, action: "admin.package_service_reviewed", entityType: "PackageServiceRequest", entityId: current.id, metadata: { action: parsed.data.action, idempotencyKey, customerNote: parsed.data.customerNote } } });
    return tx.packageServiceRequest.findUniqueOrThrow({ where: { id: current.id } });
  });
  if (!reviewed) return apiError("SERVICE_STATE_CHANGED", "This request changed while it was being reviewed.", 409);
  return apiSuccess({ request: { id: reviewed.id, reference: reviewed.reference, status: reviewed.status }, idempotentReplay: false }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
