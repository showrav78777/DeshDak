import { type NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";

import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { getLogisticsAccess } from "@/lib/warehouse-access";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { logisticsShipmentFilter } from "@/modules/logistics/access";
import { aggregateOrderStatusForShipments, canTransitionShipment } from "@/modules/logistics/state-machine";
import { createTransactionalNotification, orderNotification } from "@/modules/notifications/service";
import { canTransitionOrder } from "@/modules/orders/state-machine";

const statuses = ["CREATED", "PICKUP_PENDING", "PICKED_UP", "ORIGIN_WAREHOUSE", "CONSOLIDATED", "READY_FOR_EXPORT", "DEPARTED_ORIGIN", "IN_TRANSIT", "DESTINATION_ARRIVAL", "CUSTOMS", "CUSTOMS_CLEARED", "DESTINATION_WAREHOUSE", "OUT_FOR_DELIVERY", "DELIVERED", "FAILED_DELIVERY", "DAMAGED", "LOST", "HELD", "RETURNED", "CUSTOMS_EXCEPTION", "EXCEPTION"] as const;
const evidencePattern = /^delivery-evidence\/[a-zA-Z0-9/_-]+\.(?:jpg|jpeg|png|webp|pdf)$/;
const exceptionStatuses = new Set(["FAILED_DELIVERY", "DAMAGED", "LOST", "HELD", "RETURNED", "CUSTOMS_EXCEPTION", "EXCEPTION"]);
const schema = z.object({ status: z.enum(statuses), location: z.string().trim().min(2).max(150), description: z.string().trim().max(1000).optional(), proofReference: z.string().trim().max(500).optional(), recipientName: z.string().trim().max(120).optional() });

export async function POST(request: NextRequest, context: RouteContext<"/api/v1/operations/shipments/[shipmentId]/events">) {
  const session = await getRequestSession(request); const access = await getLogisticsAccess(session);
  if (!session || !access) return apiError("LOGISTICS_ACCESS_REQUIRED", "Logistics portal access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "This tracking update must originate from the protected Logistics application.", 403);
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
  if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 200) return apiError("IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required.", 422);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Choose the next status and provide a valid location.", 422);
  const input = parsed.data; const { shipmentId } = await context.params;
  if (exceptionStatuses.has(input.status) && !input.description) return apiError("EXCEPTION_DESCRIPTION_REQUIRED", "Describe the logistics exception before publishing it.", 422);
  if (input.proofReference && !evidencePattern.test(input.proofReference)) return apiError("INVALID_DELIVERY_EVIDENCE", "Use an approved private delivery-evidence reference.", 422);
  if (input.status === "DELIVERED" && (!input.recipientName || !input.proofReference)) return apiError("PROOF_OF_DELIVERY_REQUIRED", "Recipient name and approved proof of delivery are required.", 422);
  const requestHash = createHash("sha256").update(JSON.stringify({ shipmentId, status: input.status, location: input.location, description: input.description ?? null, proofReference: input.proofReference ?? null, recipientName: input.recipientName ?? null })).digest("hex");
  const existing = await prisma.shipment.findFirst({ where: { AND: [{ id: shipmentId }, logisticsShipmentFilter(access)] }, select: { id: true, trackingNumber: true, status: true, claimDeadline: true, packages: { select: { packageId: true, package: { select: { order: { select: { id: true, status: true, destinationCountryCode: true } } } } } } } });
  if (!existing) return apiError("SHIPMENT_NOT_FOUND", "Shipment was not found in an assigned warehouse.", 404);
  const replay = await prisma.shipmentEvent.findUnique({ where: { idempotencyKey }, select: { shipmentId: true, status: true, actorId: true, metadata: true } });
  if (replay) {
    const metadata = replay.metadata && typeof replay.metadata === "object" && !Array.isArray(replay.metadata) ? replay.metadata as Record<string, unknown> : null;
    return replay.shipmentId === shipmentId && replay.actorId === session.userId && metadata?.operation === "shipment.event" && metadata?.requestHash === requestHash ? apiSuccess({ shipment: { id: existing.id, trackingNumber: existing.trackingNumber, status: replay.status }, replayed: true }, { headers: { "Cache-Control": "private, no-store, max-age=0" } }) : apiError("IDEMPOTENCY_KEY_CONFLICT", "This mutation key was already used for another tracking event.", 409);
  }
  if (!canTransitionShipment(existing.status, input.status)) return apiError("INVALID_SHIPMENT_TRANSITION", `Shipment cannot move from ${existing.status} to ${input.status}.`, 409);
  const now = new Date(); const claimDeadline = !existing.claimDeadline && ["DELIVERED", "DAMAGED", "LOST"].includes(input.status) ? new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) : undefined;
  const result = await prisma.$transaction(async (tx) => {
    const claimed = await tx.shipment.updateMany({ where: { id: shipmentId, status: existing.status }, data: { status: input.status, shippedAt: input.status === "DEPARTED_ORIGIN" ? now : undefined, deliveredAt: input.status === "DELIVERED" ? now : undefined, claimDeadline } });
    if (claimed.count !== 1) return null;
    const shipmentEvent = await tx.shipmentEvent.create({ data: { shipmentId, status: input.status, location: input.location, description: input.description, actorId: session.userId, mediaRefs: input.proofReference ? [input.proofReference] : undefined, metadata: { operation: "shipment.event", requestHash, ...(input.recipientName ? { recipientName: input.recipientName } : {}) }, idempotencyKey } });
    if (["DEPARTED_ORIGIN", "IN_TRANSIT", "DESTINATION_ARRIVAL", "CUSTOMS", "CUSTOMS_CLEARED", "DESTINATION_WAREHOUSE", "OUT_FOR_DELIVERY", "DELIVERED"].includes(input.status) && existing.packages.length) await tx.package.updateMany({ where: { id: { in: existing.packages.map(({ packageId }) => packageId) } }, data: { status: "SHIPPED" } });
    const uniqueOrders = [...new Map(existing.packages.map(({ package: pkg }) => [pkg.order.id, pkg.order])).values()];
    for (const order of uniqueOrders) {
      const aggregate = await tx.order.findUniqueOrThrow({ where: { id: order.id }, select: { status: true, destinationCountryCode: true, packages: { where: { isOutboundActive: true }, select: { shipmentPackages: { select: { shipment: { select: { status: true } } } } } } } });
      const allAssigned = aggregate.packages.length > 0 && aggregate.packages.every(({ shipmentPackages }) => shipmentPackages.length === 1);
      const shipmentStatuses = allAssigned ? aggregate.packages.map(({ shipmentPackages }) => shipmentPackages[0].shipment.status) : [];
      const target = aggregateOrderStatusForShipments(shipmentStatuses, aggregate.destinationCountryCode);
      if (target && target !== aggregate.status && canTransitionOrder(aggregate.status, target)) {
        const updated = await tx.order.update({ where: { id: order.id }, data: { status: target }, select: { customerId: true, orderNumber: true } });
        const history = await tx.orderStatusHistory.create({ data: { orderId: order.id, fromStatus: aggregate.status, toStatus: target, actorId: session.userId, note: input.description ?? `All active packages reached ${target.toLowerCase().replaceAll("_", " ")}.` } });
        const notification = orderNotification({ userId: updated.customerId, orderId: order.id, orderNumber: updated.orderNumber, status: target, eventId: `${shipmentEvent.id}:${history.id}`, note: input.description });
        if (notification) await createTransactionalNotification(tx, notification);
      }
    }
    await tx.auditLog.create({ data: { actorId: session.userId, action: "logistics.shipment_event_created", entityType: "Shipment", entityId: shipmentId, metadata: { fromStatus: existing.status, toStatus: input.status, location: input.location, evidenceCount: input.proofReference ? 1 : 0, claimDeadline: claimDeadline?.toISOString() } } });
    return tx.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
  });
  if (!result) {
    const racedReplay = await prisma.shipmentEvent.findUnique({ where: { idempotencyKey }, select: { shipmentId: true, status: true, actorId: true, metadata: true } });
    const metadata = racedReplay?.metadata && typeof racedReplay.metadata === "object" && !Array.isArray(racedReplay.metadata) ? racedReplay.metadata as Record<string, unknown> : null;
    if (racedReplay?.shipmentId === shipmentId && racedReplay.actorId === session.userId && metadata?.operation === "shipment.event" && metadata?.requestHash === requestHash) return apiSuccess({ shipment: { id: existing.id, trackingNumber: existing.trackingNumber, status: racedReplay.status }, replayed: true }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
    return apiError("SHIPMENT_STATE_CHANGED", "This shipment changed while the update was being saved. Scan it again before retrying.", 409);
  }
  return apiSuccess({ shipment: { id: result.id, trackingNumber: result.trackingNumber, status: result.status, shippedAt: result.shippedAt, deliveredAt: result.deliveredAt, claimDeadline: result.claimDeadline }, replayed: false }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
