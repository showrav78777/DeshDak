import { Prisma } from "@prisma/client";
import { type NextRequest } from "next/server";

import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { createReference } from "@/lib/reference";
import { ROLE } from "@/lib/roles";
import { createTransactionalNotification } from "@/modules/notifications/service";
import { addBusinessDays, isReasonEligible, RMA_ACTIVE_STATUSES, rmaSlaBusinessDays } from "@/modules/rma/policy";
import { createRmaSchema } from "@/modules/rma/schemas";

const noStore = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.CUSTOMER_PERSONAL)) return apiError("AUTHENTICATION_REQUIRED", "Sign in to view your claims.", 401);
  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit") ?? 20) || 20, 1), 50);
  const cursor = request.nextUrl.searchParams.get("cursor") || undefined;
  const items = await prisma.rma.findMany({
    where: { customerId: session.userId },
    include: { order: { select: { orderNumber: true } }, shipment: { select: { trackingNumber: true } }, items: { select: { package: { select: { packageCode: true } } } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const hasMore = items.length > limit;
  const page = items.slice(0, limit);
  return apiSuccess({ rmas: page.map((rma) => ({ id: rma.id, reference: rma.reference, status: rma.status, reason: rma.reason, decision: rma.decision, orderNumber: rma.order.orderNumber, trackingNumber: rma.shipment.trackingNumber, packageCodes: rma.items.map(({ package: pkg }) => pkg.packageCode), claimDeadlineAtCreation: rma.claimDeadlineAtCreation, slaDueAt: rma.slaDueAt, createdAt: rma.createdAt })), nextCursor: hasMore ? page.at(-1)?.id ?? null : null }, { headers: noStore });
}

export async function POST(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.CUSTOMER_PERSONAL)) return apiError("AUTHENTICATION_REQUIRED", "Sign in before reporting an order problem.", 401);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "This claim must originate from the protected application.", 403);
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
  if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 200) return apiError("IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required.", 400);
  const parsed = createRmaSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Check the claim details.", 422);
  const input = parsed.data;

  const replay = await prisma.rma.findUnique({ where: { idempotencyKey }, include: { items: { select: { packageId: true } } } });
  if (replay) {
    const savedPackages = replay.items.map(({ packageId }) => packageId).sort();
    const requestedPackages = [...new Set(input.packageIds)].sort();
    const same = replay.customerId === session.userId && replay.shipmentId === input.shipmentId && replay.reason === input.reason && replay.description === input.description && JSON.stringify(savedPackages) === JSON.stringify(requestedPackages);
    return same ? apiSuccess({ rma: { id: replay.id, reference: replay.reference, status: replay.status }, idempotentReplay: true }, { headers: noStore }) : apiError("IDEMPOTENCY_KEY_PAYLOAD_MISMATCH", "This Idempotency-Key was already used for different claim details.", 409);
  }

  const packageIds = [...new Set(input.packageIds)];
  const shipment = await prisma.shipment.findUnique({ where: { id: input.shipmentId }, include: { packages: { where: { packageId: { in: packageIds } }, include: { package: { include: { order: { select: { id: true, customerId: true, type: true } } } } } } } });
  if (!shipment || shipment.packages.length !== packageIds.length || shipment.packages.some(({ package: pkg }) => pkg.order.customerId !== session.userId)) return apiError("SHIPMENT_NOT_FOUND", "The shipment or selected packages were not found in your account.", 404);
  const orders = [...new Map(shipment.packages.map(({ package: pkg }) => [pkg.order.id, pkg.order])).values()];
  if (orders.length !== 1) return apiError("CLAIM_PACKAGES_MUST_SHARE_ORDER", "Create a separate claim for packages from each order.", 422);
  const order = orders[0];
  if (!isReasonEligible(order.type, input.reason)) return apiError("CLAIM_REASON_NOT_ELIGIBLE", order.type === "SHIP_FOR_ME" ? "Ship for Me claims cover only loss or damage after warehouse receipt." : "This reason is not eligible under the return and refund policy.", 422);
  if (!["DELIVERED", "DAMAGED", "LOST"].includes(shipment.status) || !shipment.claimDeadline) return apiError("CLAIM_NOT_AVAILABLE", "A claim is available only after confirmed delivery, loss, or damage with a recorded claim deadline.", 409);
  if (input.reason === "LOST" && shipment.status !== "LOST") return apiError("CLAIM_REASON_NOT_CONFIRMED", "A lost-shipment claim requires a confirmed lost tracking status.", 409);
  if (input.reason === "NOT_DELIVERED" && shipment.status !== "LOST") return apiError("CLAIM_REASON_NOT_CONFIRMED", "A non-delivery claim requires a confirmed lost shipment or the documented maximum delivery window.", 409);
  const now = new Date();
  if (now.getTime() > shipment.claimDeadline.getTime()) return apiError("CLAIM_WINDOW_EXPIRED", "The shipment claim deadline has passed. Contact support if an administrator should review an exceptional late claim.", 422, { claimDeadline: shipment.claimDeadline.toISOString() });
  const active = await prisma.rma.findFirst({ where: { shipmentId: shipment.id, orderId: order.id, status: { in: RMA_ACTIVE_STATUSES } }, select: { id: true, reference: true } });
  if (active) return apiError("ACTIVE_CLAIM_EXISTS", `Claim ${active.reference} is already open for this shipment.`, 409, { rmaId: active.id });

  try {
    const created = await prisma.$transaction(async (tx) => {
      const rma = await tx.rma.create({ data: { reference: createReference("RMA"), idempotencyKey, orderId: order.id, shipmentId: shipment.id, customerId: session.userId, reason: input.reason, description: input.description, evidenceRefs: input.evidenceReferences, claimDeadlineAtCreation: shipment.claimDeadline!, slaDueAt: addBusinessDays(now, rmaSlaBusinessDays()), items: { create: packageIds.map((packageId) => ({ packageId })) }, events: { create: { toStatus: "RETURN_REQUESTED", actorId: session.userId, note: "Customer submitted an eligible claim with private evidence references.", idempotencyKey: `rma-created:${idempotencyKey}`, metadata: { reason: input.reason, evidenceCount: input.evidenceReferences.length } } } } });
      await tx.auditLog.create({ data: { actorId: session.userId, action: "rma.customer_created", entityType: "Rma", entityId: rma.id, metadata: { orderId: order.id, shipmentId: shipment.id, reason: input.reason, packageCount: packageIds.length, evidenceCount: input.evidenceReferences.length, claimDeadline: shipment.claimDeadline!.toISOString() } } });
      await createTransactionalNotification(tx, { userId: session.userId, eventType: "RMA_RETURN_REQUESTED", title: "Claim received", body: `Claim ${rma.reference} is under review. We aim to respond within ${rmaSlaBusinessDays()} business days.`, deepLink: `/rmas/${rma.id}`, entityType: "Rma", entityId: rma.id, priority: "HIGH", idempotencyKey: `rma-notification:created:${rma.id}` });
      return rma;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return apiSuccess({ rma: { id: created.id, reference: created.reference, status: created.status, slaDueAt: created.slaDueAt }, idempotentReplay: false }, { status: 201, headers: noStore });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      const existing = await prisma.rma.findUnique({ where: { idempotencyKey } });
      if (existing?.customerId === session.userId) return apiSuccess({ rma: { id: existing.id, reference: existing.reference, status: existing.status }, idempotentReplay: true }, { headers: noStore });
    }
    if ((error as { code?: string }).code === "P2034") return apiError("CLAIM_RETRY_REQUIRED", "The shipment changed while the claim was submitted. Review it and retry.", 409);
    throw error;
  }
}
