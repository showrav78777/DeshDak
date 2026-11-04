import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { createReference } from "@/lib/reference";
import { ROLE } from "@/lib/roles";
import { screenRestrictedGoods } from "@/modules/compliance/restricted-goods";

const schema = z.object({ sourceCountryCode: z.string().trim().length(2).toUpperCase().default("CN"), productUrl: z.string().url().max(2048), productTitle: z.string().trim().min(3).max(250).optional(), selectedVariant: z.string().trim().max(250).optional(), quantity: z.coerce.number().int().min(1).max(1000), sourcePrice: z.coerce.number().positive().max(9_999_999).optional(), sourceCurrency: z.string().trim().length(3).toUpperCase().optional(), customerNote: z.string().trim().max(1000).optional() });

export async function POST(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.CUSTOMER_PERSONAL)) return apiError("CUSTOMER_ACCESS_REQUIRED", "Sign in with a customer account to submit a Buy & Ship request.", 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Please check the product link and request details.", 422, z.treeifyError(parsed.error));
  const country = await prisma.country.findUnique({ where: { isoCode: parsed.data.sourceCountryCode }, select: { isActive: true, originLanes: { where: { isActive: true }, select: { id: true } } } });
  if (country && (!country.isActive || country.originLanes.length === 0)) return apiError("SOURCE_COUNTRY_NOT_AVAILABLE", "This source country is not currently available.", 422);
  if (!country) {
    const configuredCountryCount = await prisma.country.count();
    if (parsed.data.sourceCountryCode !== "CN" || configuredCountryCount > 0) return apiError("SOURCE_COUNTRY_NOT_AVAILABLE", "This source country is not currently available.", 422);
  }
  const result = await prisma.$transaction(async (tx) => {
    const screening = await screenRestrictedGoods(tx, { subject: "SOURCING_REQUEST", customerId: session.userId, originCountryCode: parsed.data.sourceCountryCode, destinationCountryCode: "BD", text: [parsed.data.productTitle, parsed.data.selectedVariant, parsed.data.customerNote] });
    if (!screening.allowed) {
      await tx.auditLog.create({ data: { actorId: session.userId, action: screening.outcome === "BLOCKED" ? "compliance.sourcing_blocked" : "compliance.sourcing_review_required", entityType: "ComplianceScreeningAttempt", entityId: screening.attempt.id, metadata: { matchedRuleCodes: screening.attempt.matchedRuleCodes, sourceCountryCode: parsed.data.sourceCountryCode } } });
      return { screening, sourcingRequest: null };
    }
    const created = await tx.sourcingRequest.create({ data: { reference: createReference("BS"), customerId: session.userId, ...parsed.data } });
    await tx.complianceScreeningAttempt.update({ where: { id: screening.attempt.id }, data: { subjectReference: created.id } });
    await tx.auditLog.create({ data: { actorId: session.userId, action: "sourcing_request.submitted", entityType: "SourcingRequest", entityId: created.id } });
    return { screening, sourcingRequest: created };
  });
  if (!result.sourcingRequest) return apiError(result.screening.outcome === "BLOCKED" ? "RESTRICTED_GOODS_BLOCKED" : "COMPLIANCE_REVIEW_REQUIRED", result.screening.customerMessage ?? "This request cannot continue until a compliance review is completed.", result.screening.outcome === "BLOCKED" ? 422 : 409, { screeningReference: result.screening.attempt.id });
  return apiSuccess({ sourcingRequest: result.sourcingRequest }, { status: 201 });
}

export async function GET(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.CUSTOMER_PERSONAL)) return apiError("CUSTOMER_ACCESS_REQUIRED", "Sign in with a customer account.", 403);
  const requests = await prisma.sourcingRequest.findMany({ where: { customerId: session.userId }, orderBy: { createdAt: "desc" } });
  return apiSuccess({ requests });
}
