import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { hasRequiredFxCoverage } from "@/modules/fx/service";
import { isPaymentProviderConfigured } from "@/modules/payments/registry";

const optionalAmount = z.preprocess((value) => value === "" || value === null || value === undefined ? null : value, z.coerce.number().positive().max(999_999_999).nullable());
const schema = z.object({ countryId: z.string().uuid(), customerCurrency: z.string().trim().length(3).toUpperCase(), minimumAmount: optionalAmount, maximumAmount: optionalAmount, financeApproved: z.boolean(), complianceApproved: z.boolean(), refundsApproved: z.boolean(), reconciliationApproved: z.boolean(), checkoutEnabled: z.boolean() }).refine((value) => !value.minimumAmount || !value.maximumAmount || value.maximumAmount >= value.minimumAmount, { message: "Maximum amount must not be below minimum amount." });

export async function PUT(request: NextRequest, context: RouteContext<"/api/v1/admin/payment-methods/[methodId]/availability">) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN)) return apiError("ADMIN_ACCESS_REQUIRED", "Administrator access is required.", 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Provide valid country availability, amount limits, and readiness approvals.", 422, z.treeifyError(parsed.error));
  const { methodId } = await context.params;
  const [method, country] = await Promise.all([prisma.paymentMethod.findUnique({ where: { id: methodId } }), prisma.country.findUnique({ where: { id: parsed.data.countryId } })]);
  if (!method || !country) return apiError("CONFIGURATION_NOT_FOUND", "Payment method or country was not found.", 404);
  const approved = parsed.data.financeApproved && parsed.data.complianceApproved && parsed.data.refundsApproved && parsed.data.reconciliationApproved;
  if (parsed.data.checkoutEnabled && (!approved || !method.isActive || !country.isActive || !isPaymentProviderConfigured(method.adapterCode))) return apiError("PAYMENT_METHOD_NOT_CHECKOUT_READY", "Activate the country and method, connect the runtime adapter, and record every approval before opening checkout.", 409);
  if (parsed.data.checkoutEnabled && !(await hasRequiredFxCoverage(prisma, "BDT", parsed.data.customerCurrency))) return apiError("PAYMENT_METHOD_FX_NOT_READY", "Activate approved BDT conversion rates for both personal and business customers before opening this currency at checkout.", 409);
  const data = { ...parsed.data, minimumAmount: parsed.data.minimumAmount, maximumAmount: parsed.data.maximumAmount, checkoutEnabled: parsed.data.checkoutEnabled && approved };
  const availability = await prisma.$transaction(async (tx) => {
    const saved = await tx.countryPaymentMethod.upsert({ where: { countryId_paymentMethodId_customerCurrency: { countryId: country.id, paymentMethodId: method.id, customerCurrency: parsed.data.customerCurrency } }, create: { paymentMethodId: method.id, ...data }, update: data });
    if (!saved.checkoutEnabled) {
      const alternatives = await tx.countryPaymentMethod.findMany({ where: { countryId: country.id, checkoutEnabled: true, financeApproved: true, complianceApproved: true, refundsApproved: true, reconciliationApproved: true, paymentMethod: { is: { isActive: true } } }, select: { paymentMethod: { select: { adapterCode: true } } } });
      if (!alternatives.some(({ paymentMethod }) => isPaymentProviderConfigured(paymentMethod.adapterCode))) {
        const closed = await tx.shippingLane.updateMany({ where: { destinationCountryId: country.id, checkoutEnabled: true }, data: { checkoutEnabled: false } });
        if (closed.count) await tx.auditLog.create({ data: { actorId: session.userId, action: "shipping_lane.checkout_closed_by_payment_readiness", entityType: "Country", entityId: country.id, metadata: { countryCode: country.isoCode, closedLaneCount: closed.count } } });
      }
    }
    await tx.auditLog.create({ data: { actorId: session.userId, action: "payment_method.country_availability_changed", entityType: "CountryPaymentMethod", entityId: saved.id, metadata: { paymentMethodCode: method.code, countryCode: country.isoCode, customerCurrency: saved.customerCurrency, approvals: { finance: saved.financeApproved, compliance: saved.complianceApproved, refunds: saved.refundsApproved, reconciliation: saved.reconciliationApproved }, checkoutEnabled: saved.checkoutEnabled } } });
    return saved;
  });
  return apiSuccess({ availability });
}
