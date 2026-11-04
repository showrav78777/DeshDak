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
import { adminCreateRmaSchema } from "@/modules/rma/schemas";

const noStore = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") return apiError("ADMIN_ACCESS_REQUIRED", "Admin access is required.", 403);
  const status = request.nextUrl.searchParams.get("status");
  const allowedStatuses = ["RETURN_REQUESTED", "RETURN_APPROVED", "RETURN_REJECTED", "RETURN_IN_TRANSIT", "RETURN_RECEIVED", "INSPECTED", "REFUNDED", "REPLACED", "CLOSED"];
  const rmas = await prisma.rma.findMany({ where: status && allowedStatuses.includes(status) ? { status: status as never } : undefined, include: { customer: { select: { fullName: true, email: true } }, order: { select: { orderNumber: true, currency: true } }, shipment: { select: { trackingNumber: true } }, items: { select: { package: { select: { packageCode: true } } } } }, orderBy: [{ slaDueAt: "asc" }, { createdAt: "asc" }], take: 100 });
  return apiSuccess({ rmas }, { headers: noStore });
}

export async function POST(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") return apiError("ADMIN_ACCESS_REQUIRED", "Admin access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "This override must originate from the protected Admin application.", 403);
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
  if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 200) return apiError("IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required.", 400);
  const parsed = adminCreateRmaSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Check the late-claim details.", 422);
  const replay = await prisma.rma.findUnique({ where: { idempotencyKey }, select: { id: true, reference: true, status: true } });
  if (replay) return apiSuccess({ rma: replay, idempotentReplay: true }, { headers: noStore });
  const input = parsed.data; const packageIds = [...new Set(input.packageIds)];
  const shipment = await prisma.shipment.findUnique({ where: { id: input.shipmentId }, include: { packages: { where: { packageId: { in: packageIds } }, include: { package: { include: { order: { select: { id: true, customerId: true, type: true } } } } } } } });
  if (!shipment || shipment.packages.length !== packageIds.length || !shipment.claimDeadline) return apiError("SHIPMENT_NOT_FOUND", "The shipment, packages, or claim deadline could not be verified.", 404);
  const orders = [...new Map(shipment.packages.map(({ package: pkg }) => [pkg.order.id, pkg.order])).values()];
  if (orders.length !== 1) return apiError("CLAIM_PACKAGES_MUST_SHARE_ORDER", "Create a separate claim for packages from each order.", 422);
  const order = orders[0];
  if (!isReasonEligible(order.type, input.reason)) return apiError("CLAIM_REASON_NOT_ELIGIBLE", "The selected reason is not eligible for this order type.", 422);
  const now = new Date();
  if (now.getTime() <= shipment.claimDeadline.getTime()) return apiError("DEADLINE_OVERRIDE_NOT_REQUIRED", "The claim window is still open; the customer can submit this claim normally.", 409);
  const active = await prisma.rma.findFirst({ where: { shipmentId: shipment.id, orderId: order.id, status: { in: RMA_ACTIVE_STATUSES } }, select: { reference: true } });
  if (active) return apiError("ACTIVE_CLAIM_EXISTS", `Claim ${active.reference} is already open for this shipment.`, 409);
  try {
    const created = await prisma.$transaction(async (tx) => {
      const rma = await tx.rma.create({ data: { reference: createReference("RMA"), idempotencyKey, orderId: order.id, shipmentId: shipment.id, customerId: order.customerId, reason: input.reason, description: input.description, evidenceRefs: input.evidenceReferences, claimDeadlineAtCreation: shipment.claimDeadline!, createdAfterDeadline: true, overrideReason: input.overrideReason, overriddenById: session.userId, overriddenAt: now, slaDueAt: addBusinessDays(now, rmaSlaBusinessDays()), items: { create: packageIds.map((packageId) => ({ packageId })) }, events: { create: { toStatus: "RETURN_REQUESTED", actorId: session.userId, note: "Administrator created an exceptional late claim after documenting the override reason.", idempotencyKey: `rma-admin-created:${idempotencyKey}`, metadata: { reason: input.reason, createdAfterDeadline: true, evidenceCount: input.evidenceReferences.length } } } } });
      await tx.auditLog.create({ data: { actorId: session.userId, action: "rma.deadline_overridden", entityType: "Rma", entityId: rma.id, metadata: { orderId: order.id, shipmentId: shipment.id, customerId: order.customerId, claimDeadline: shipment.claimDeadline!.toISOString(), overrideReason: input.overrideReason } } });
      await createTransactionalNotification(tx, { userId: order.customerId, eventType: "RMA_RETURN_REQUESTED", title: "Exceptional claim opened", body: `An administrator opened claim ${rma.reference} for review.`, deepLink: `/rmas/${rma.id}`, entityType: "Rma", entityId: rma.id, priority: "HIGH", idempotencyKey: `rma-notification:admin-created:${rma.id}` });
      return rma;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return apiSuccess({ rma: { id: created.id, reference: created.reference, status: created.status }, idempotentReplay: false }, { status: 201, headers: noStore });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return apiError("RMA_CREATE_CONFLICT", "The late claim was already created or conflicts with another request.", 409);
    throw error;
  }
}
