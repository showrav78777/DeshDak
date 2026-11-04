import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { restrictedGoodsRuleStatusSchema } from "@/modules/compliance/schemas";
import { rescreenPublicCatalog } from "@/modules/compliance/restricted-goods";

export async function PATCH(request: NextRequest, context: { params: Promise<{ ruleId: string }> }) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") return apiError("ADMIN_ACCESS_REQUIRED", "Administrator access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "Compliance changes must originate from the protected Admin application.", 403);
  const parsed = restrictedGoodsRuleStatusSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Choose a valid compliance-rule state.", 422, { fields: parsed.error.flatten().fieldErrors });
  const { ruleId } = await context.params;
  const current = await prisma.restrictedGoodsRule.findUnique({ where: { id: ruleId } });
  if (!current) return apiError("COMPLIANCE_RULE_NOT_FOUND", "Compliance rule not found.", 404);
  if (current.status === "ARCHIVED") return apiError("COMPLIANCE_RULE_TERMINAL", "An archived rule cannot be changed.", 409);
  const now = new Date();
  if (parsed.data.status === "ACTIVE" && current.effectiveTo && current.effectiveTo <= now) return apiError("COMPLIANCE_RULE_EXPIRED", "This rule's effective window has ended.", 409);
  const targetStatus = parsed.data.status === "ACTIVE" && current.effectiveFrom && current.effectiveFrom > now ? "SCHEDULED" : parsed.data.status;
  const updated = await prisma.$transaction(async (tx) => {
    const changed = await tx.restrictedGoodsRule.updateMany({ where: { id: ruleId, version: parsed.data.version }, data: { status: targetStatus, version: { increment: 1 }, updatedById: session.userId } });
    if (changed.count !== 1) return null;
    const rule = await tx.restrictedGoodsRule.findUniqueOrThrow({ where: { id: ruleId } });
    const catalogRescreened = current.status === "ACTIVE" || rule.status === "ACTIVE";
    const catalog = catalogRescreened ? await rescreenPublicCatalog(tx) : { clear: 0, blocked: 0, reviewRequired: 0 };
    await tx.auditLog.create({ data: { actorId: session.userId, action: "compliance.rule_status_changed", entityType: "RestrictedGoodsRule", entityId: rule.id, metadata: { ruleCode: rule.ruleCode, fromStatus: current.status, requestedStatus: parsed.data.status, toStatus: rule.status, version: rule.version, catalogRescreened, publicCatalog: catalog } } });
    return rule;
  });
  if (!updated) return apiError("COMPLIANCE_RULE_VERSION_CONFLICT", "This rule changed in another session. Refresh and try again.", 409);
  return apiSuccess({ rule: updated }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
