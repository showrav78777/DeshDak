import { authorizeComplianceRuleAdmin } from "@/modules/compliance/rule-authorization";
import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { restrictedGoodsRuleCreateSchema } from "@/modules/compliance/schemas";

function cleanList(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export async function GET(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") return apiError("ADMIN_ACCESS_REQUIRED", "Administrator access is required.", 403);
  const rules = await prisma.restrictedGoodsRule.findMany({ orderBy: [{ status: "asc" }, { createdAt: "desc" }] });
  return apiSuccess({ rules }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function POST(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") return apiError("ADMIN_ACCESS_REQUIRED", "Administrator access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "Compliance changes must originate from the protected Admin application.", 403);
  const parsed = restrictedGoodsRuleCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Check the compliance rule.", 422, { fields: parsed.error.flatten().fieldErrors });
  const data = parsed.data;
  const countryCodes = [data.originCountryCode, data.destinationCountryCode].filter((value): value is string => Boolean(value));
  if (countryCodes.length) {
    const configured = await prisma.country.count({ where: { isoCode: { in: countryCodes } } });
    if (configured !== new Set(countryCodes).size) return apiError("COUNTRY_NOT_CONFIGURED", "Choose countries already configured in Admin.", 422);
  }
  try {
    const rule = await prisma.$transaction(async (tx) => {
      if (!await authorizeComplianceRuleAdmin(tx, session.userId, session.sessionId)) return null;
      const created = await tx.restrictedGoodsRule.create({ data: {
        ruleCode: data.ruleCode,
        name: data.name,
        internalDescription: data.internalDescription || null,
        customerMessage: data.customerMessage,
        action: data.action,
        keywords: cleanList(data.keywords),
        hsCodePrefixes: cleanList(data.hsCodePrefixes),
        originCountryCode: data.originCountryCode || null,
        destinationCountryCode: data.destinationCountryCode || null,
        effectiveFrom: data.effectiveFrom || null,
        effectiveTo: data.effectiveTo || null,
        legalReference: data.legalReference || null,
        createdById: session.userId,
        updatedById: session.userId,
      } });
      await tx.auditLog.create({ data: { actorId: session.userId, action: "compliance.rule_created", entityType: "RestrictedGoodsRule", entityId: created.id, metadata: { ruleCode: created.ruleCode, action: created.action, status: created.status } } });
      return created;
    });
    if (!rule) return apiError("ADMIN_ACCESS_REQUIRED", "Your rule-management access changed. Sign in again before changing rules.", 403);
    return apiSuccess({ rule }, { status: 201, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return apiError("COMPLIANCE_RULE_CODE_EXISTS", "A compliance rule already uses this code.", 409);
    throw error;
  }
}
