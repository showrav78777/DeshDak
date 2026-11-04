import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { isPaymentProviderConfigured } from "@/modules/payments/registry";

const schema = z.object({ isActive: z.boolean().optional(), displayName: z.string().trim().min(2).max(80).optional(), secretReference: z.string().trim().max(255).refine((value) => !value || value.startsWith("secret://"), "Use a secret:// reference.").optional() }).refine((value) => Object.keys(value).length > 0, "Provide a setting to update.");

export async function PATCH(request: NextRequest, context: RouteContext<"/api/v1/admin/payment-methods/[methodId]">) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN)) return apiError("ADMIN_ACCESS_REQUIRED", "Administrator access is required.", 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Provide valid payment-method settings.", 422);
  const { methodId } = await context.params;
  const existing = await prisma.paymentMethod.findUnique({ where: { id: methodId } });
  if (!existing) return apiError("PAYMENT_METHOD_NOT_FOUND", "Payment method was not found.", 404);
  if (parsed.data.isActive === true && !isPaymentProviderConfigured(existing.adapterCode)) return apiError("PAYMENT_ADAPTER_NOT_CONFIGURED", "Connect the approved runtime credential and adapter before activating this method.", 409);
  const update = { ...parsed.data, ...(parsed.data.secretReference !== undefined ? { secretReference: parsed.data.secretReference || null } : {}) };
  const method = await prisma.$transaction(async (tx) => {
    const saved = await tx.paymentMethod.update({ where: { id: methodId }, data: update });
    if (parsed.data.isActive === false) {
      const affected = await tx.countryPaymentMethod.findMany({ where: { paymentMethodId: methodId, checkoutEnabled: true }, select: { countryId: true } });
      await tx.countryPaymentMethod.updateMany({ where: { paymentMethodId: methodId, checkoutEnabled: true }, data: { checkoutEnabled: false } });
      for (const countryId of new Set(affected.map(({ countryId }) => countryId))) {
        const alternatives = await tx.countryPaymentMethod.findMany({ where: { countryId, checkoutEnabled: true, financeApproved: true, complianceApproved: true, refundsApproved: true, reconciliationApproved: true, paymentMethod: { is: { isActive: true } } }, select: { paymentMethod: { select: { adapterCode: true } } } });
        if (!alternatives.some(({ paymentMethod }) => isPaymentProviderConfigured(paymentMethod.adapterCode))) {
          const closed = await tx.shippingLane.updateMany({ where: { destinationCountryId: countryId, checkoutEnabled: true }, data: { checkoutEnabled: false } });
          if (closed.count) await tx.auditLog.create({ data: { actorId: session.userId, action: "shipping_lane.checkout_closed_by_payment_method", entityType: "Country", entityId: countryId, metadata: { paymentMethodId: methodId, closedLaneCount: closed.count } } });
        }
      }
    }
    await tx.auditLog.create({ data: { actorId: session.userId, action: "payment_method.settings_changed", entityType: "PaymentMethod", entityId: methodId, metadata: { changed: { ...parsed.data, secretReference: parsed.data.secretReference === undefined ? undefined : "[REFERENCE_UPDATED]" } } } });
    return saved;
  });
  return apiSuccess({ method });
}
