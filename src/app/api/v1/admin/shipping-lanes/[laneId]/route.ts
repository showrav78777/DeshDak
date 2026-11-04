import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { hasRequiredFxCoverage } from "@/modules/fx/service";
import { isPaymentProviderConfigured } from "@/modules/payments/registry";

const optionalDay = z.preprocess((value) => value === "" || value === undefined ? undefined : value, z.coerce.number().int().min(1).max(365).optional());
const optionalEstimate = z.preprocess((value) => value === "" || value === undefined ? undefined : value, z.coerce.number().min(0).max(1_000_000).nullable().optional());
const schema = z.object({
  isActive: z.boolean().optional(),
  financeApproved: z.boolean().optional(),
  complianceApproved: z.boolean().optional(),
  operationsApproved: z.boolean().optional(),
  checkoutEnabled: z.boolean().optional(),
  dimensionalWeightDivisor: z.coerce.number().int().min(1_000).max(10_000).optional(),
  weightDiscrepancyThresholdPercent: z.coerce.number().min(0).max(1000).optional(),
  estimatedRatePerKgBdt: optionalEstimate,
  estimatedLastMileRatePerKgBdt: optionalEstimate,
  estimatedHandlingFeeBdt: optionalEstimate,
  estimatedMinimumChargeBdt: optionalEstimate,
  transitDaysMin: optionalDay,
  transitDaysMax: optionalDay,
}).refine((value) => Object.values(value).some((item) => item !== undefined), { message: "Provide at least one lane setting." });

export async function PATCH(request: NextRequest, context: RouteContext<"/api/v1/admin/shipping-lanes/[laneId]">) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN)) return apiError("ADMIN_ACCESS_REQUIRED", "Admin access is required.", 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Please provide valid lane settings.", 422);
  const { laneId } = await context.params;
  const lane = await prisma.shippingLane.findUnique({ where: { id: laneId }, include: { originCountry: { select: { isActive: true } }, destinationCountry: { select: { isActive: true } } } });
  if (!lane) return apiError("SHIPPING_LANE_NOT_FOUND", "Shipping lane was not found.", 404);
  const nextMin = parsed.data.transitDaysMin ?? lane.transitDaysMin;
  const nextMax = parsed.data.transitDaysMax ?? lane.transitDaysMax;
  if (nextMin && nextMax && nextMax < nextMin) return apiError("TRANSIT_RANGE_INVALID", "Maximum transit days must not be less than minimum transit days.", 422);
  const readiness = {
    isActive: parsed.data.isActive ?? lane.isActive,
    financeApproved: parsed.data.financeApproved ?? lane.financeApproved,
    complianceApproved: parsed.data.complianceApproved ?? lane.complianceApproved,
    operationsApproved: parsed.data.operationsApproved ?? lane.operationsApproved,
  };
  if (parsed.data.checkoutEnabled === true && (!readiness.isActive || !readiness.financeApproved || !readiness.complianceApproved || !readiness.operationsApproved || !lane.originCountry.isActive || !lane.destinationCountry.isActive)) {
    return apiError("LANE_NOT_CHECKOUT_READY", "Activate both countries and the lane, then record finance, compliance, and operations approval before enabling checkout.", 409);
  }
  if (parsed.data.checkoutEnabled === true) {
    const paymentAvailability = await prisma.countryPaymentMethod.findMany({ where: { countryId: lane.destinationCountryId, checkoutEnabled: true, financeApproved: true, complianceApproved: true, refundsApproved: true, reconciliationApproved: true, paymentMethod: { is: { isActive: true } } }, select: { customerCurrency: true, paymentMethod: { select: { adapterCode: true } } } });
    const ready = await Promise.all(paymentAvailability.filter(({ paymentMethod }) => isPaymentProviderConfigured(paymentMethod.adapterCode)).map(({ customerCurrency }) => hasRequiredFxCoverage(prisma, "BDT", customerCurrency)));
    if (!ready.some(Boolean)) return apiError("DESTINATION_PAYMENT_METHOD_REQUIRED", "Approve and enable at least one runtime-connected payment method with complete personal and business FX coverage before opening this shipping lane.", 409);
  }
  const readinessRevoked = parsed.data.isActive === false || parsed.data.financeApproved === false || parsed.data.complianceApproved === false || parsed.data.operationsApproved === false;
  const update = { ...parsed.data, ...(readinessRevoked ? { checkoutEnabled: false } : {}) };
  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.shippingLane.update({ where: { id: laneId }, data: update });
    await tx.auditLog.create({ data: { actorId: session.userId, action: parsed.data.checkoutEnabled === undefined ? "shipping_lane.settings_changed" : "shipping_lane.checkout_changed", entityType: "ShippingLane", entityId: laneId, metadata: { name: lane.name, changed: update } } });
    return saved;
  });
  return apiSuccess({ lane: updated });
}
