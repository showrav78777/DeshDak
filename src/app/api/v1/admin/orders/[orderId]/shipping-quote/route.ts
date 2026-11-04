import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { createTransactionalNotification, orderNotification } from "@/modules/notifications/service";

const schema = z.object({
  shippingLaneId: z.string().uuid(),
  ratePerKgBdt: z.coerce.number().positive().max(1_000_000),
  lastMileRatePerKgBdt: z.coerce.number().min(0).max(1_000_000).default(0),
  handlingFeeBdt: z.coerce.number().min(0).max(10_000_000).default(0),
  insuranceFeeBdt: z.coerce.number().min(0).max(10_000_000).default(0),
  expiresAt: z.string().datetime(),
  note: z.string().trim().max(1000).optional(),
});

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export async function POST(request: NextRequest, context: RouteContext<"/api/v1/admin/orders/[orderId]/shipping-quote">) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN)) return apiError("ADMIN_ACCESS_REQUIRED", "Admin access is required.", 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Please check the shipping quote values.", 422, z.treeifyError(parsed.error));
  const expiresAt = new Date(parsed.data.expiresAt);
  if (expiresAt <= new Date()) return apiError("QUOTE_EXPIRY_INVALID", "The shipping quote expiry must be in the future.", 422);

  const { orderId } = await context.params;
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      packages: { where: { isOutboundActive: true }, select: { status: true, chargeableWeightGrams: true } },
      packageExceptions: { where: { status: "OPEN" }, select: { id: true }, take: 1 },
      packageServiceRequests: { where: { status: { in: ["REQUESTED", "APPROVED"] } }, select: { id: true }, take: 1 },
      sourcingRequest: { include: { quotes: { where: { status: "ACCEPTED" }, orderBy: { version: "desc" }, take: 1 } } },
    },
  });
  if (!order) return apiError("ORDER_NOT_FOUND", "Order was not found.", 404);
  if (order.status !== "MEASURED") return apiError("ORDER_NOT_MEASURED", "A shipping quote can only be issued after package measurement.", 409);
  if (order.packageExceptions.length) return apiError("OPEN_PACKAGE_EXCEPTION", "Resolve every open parcel exception before issuing a shipping quote.", 409);
  if (order.packageServiceRequests.length) return apiError("OPEN_PACKAGE_SERVICE", "Complete or reject every package handling request before issuing a shipping quote.", 409);
  if (!order.packages.length || order.packages.some((pkg) => pkg.status !== "MEASURED" || !pkg.chargeableWeightGrams)) return apiError("PACKAGE_MEASUREMENT_REQUIRED", "Every package must have a confirmed chargeable weight.", 409);

  const sourceCountryCode = order.originCountryCode ?? order.sourcingRequest?.sourceCountryCode ?? "CN";
  if (order.shippingLaneId && order.shippingLaneId !== parsed.data.shippingLaneId) return apiError("ORDER_LANE_MISMATCH", "Use the approved shipping lane already assigned to this order.", 422);
  const lane = await prisma.shippingLane.findFirst({
    where: { id: parsed.data.shippingLaneId, isActive: true, financeApproved: true, complianceApproved: true, operationsApproved: true, originCountry: { isoCode: sourceCountryCode } },
    select: { id: true, name: true, weightDiscrepancyThresholdPercent: true },
  });
  if (!lane) return apiError("ACTIVE_SHIPPING_LANE_REQUIRED", "Choose an active lane for this order's source country.", 422);

  const chargeableWeightGrams = order.packages.reduce((sum, pkg) => sum + (pkg.chargeableWeightGrams ?? 0), 0);
  const declaredWeightGrams = order.sourcingRequest?.quotes[0]?.declaredWeightGrams ?? null;
  const discrepancyPercent = declaredWeightGrams ? money(((chargeableWeightGrams - declaredWeightGrams) / declaredWeightGrams) * 100) : null;
  const threshold = Number(lane.weightDiscrepancyThresholdPercent);
  const approvalRequired = discrepancyPercent === null || Math.abs(discrepancyPercent) > threshold;
  const shippingAmountBdt = money((chargeableWeightGrams / 1000) * parsed.data.ratePerKgBdt);
  const lastMileDeliveryBdt = money((chargeableWeightGrams / 1000) * parsed.data.lastMileRatePerKgBdt);
  const totalBdt = money(shippingAmountBdt + lastMileDeliveryBdt + parsed.data.handlingFeeBdt + parsed.data.insuranceFeeBdt);
  const nextStatus = approvalRequired ? "SHIPPING_QUOTE_PENDING_CUSTOMER_APPROVAL" as const : "SHIPPING_QUOTE_READY" as const;

  const quote = await prisma.$transaction(async (tx) => {
    const latest = await tx.shippingQuote.aggregate({ where: { orderId }, _max: { version: true } });
    await tx.shippingQuote.updateMany({ where: { orderId, status: "SENT" }, data: { status: "EXPIRED" } });
    const created = await tx.shippingQuote.create({ data: { orderId, version: (latest._max.version ?? 0) + 1, shippingLaneId: lane.id, chargeableWeightGrams, declaredWeightGrams, discrepancyPercent, discrepancyThresholdPercent: threshold, ratePerKgBdt: parsed.data.ratePerKgBdt, shippingAmountBdt, lastMileRatePerKgBdt: parsed.data.lastMileRatePerKgBdt, lastMileDeliveryBdt, handlingFeeBdt: parsed.data.handlingFeeBdt, insuranceFeeBdt: parsed.data.insuranceFeeBdt, totalBdt, status: approvalRequired ? "SENT" : "ACCEPTED", acceptedAt: approvalRequired ? null : new Date(), note: parsed.data.note || null, expiresAt, createdById: session.userId } });
    await tx.order.update({ where: { id: orderId }, data: { status: nextStatus, weightDiscrepancyFlag: approvalRequired, shippingApprovalStatus: approvalRequired ? "PENDING" : "NOT_REQUIRED", shippingApprovalAt: null, statusHistory: { create: { fromStatus: order.status, toStatus: nextStatus, actorId: session.userId, note: approvalRequired ? `Final shipping quote issued after measurement. Customer approval is required before payment.` : `Final shipping quote issued after measurement and is ready for payment.` } } } });
    const notification = orderNotification({ userId: order.customerId, orderId: order.id, orderNumber: order.orderNumber, status: nextStatus, eventId: `shipping-quote:${created.id}` });
    if (notification) await createTransactionalNotification(tx, notification);
    await tx.auditLog.create({ data: { actorId: session.userId, action: "shipping_quote.sent", entityType: "ShippingQuote", entityId: created.id, metadata: { orderId, laneId: lane.id, version: created.version, chargeableWeightGrams, declaredWeightGrams, discrepancyPercent, discrepancyThresholdPercent: threshold, approvalRequired, shippingAmountBdt, lastMileDeliveryBdt, totalBdt } } });
    return created;
  });
  return apiSuccess({ quote, approvalRequired }, { status: 201 });
}
