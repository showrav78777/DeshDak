import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";

const optionalPositive = z.preprocess((value) => value === "" || value === null || value === undefined ? null : value, z.coerce.number().int().positive().max(10_000_000).nullable());
const schema = z.object({ displayName: z.preprocess((value) => value === "" || value === null ? null : value, z.string().trim().max(100).nullable()).optional(), secretReference: z.string().trim().regex(/^secret:\/\/[A-Za-z0-9_./-]{3,240}$/).optional(), rateLimitPerMinute: optionalPositive.optional(), dailyQuota: optionalPositive.optional(), credentialExpiresAt: z.preprocess((value) => value === "" || value === null ? null : value, z.coerce.date().min(new Date()).nullable()).optional(), isActive: z.boolean().optional() }).strict().refine((value) => Object.keys(value).length > 0, "Provide at least one account setting.");

export async function PATCH(request: NextRequest, context: { params: Promise<{ accountId: string }> }) {
  const session = await getRequestSession(request); if (!session?.roles.includes(ROLE.ADMIN)) return apiError("ADMIN_ACCESS_REQUIRED", "Admin access is required.", 403);
  const parsed = schema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Provide valid account settings.", 422); if (parsed.data.isActive === true) return apiError("EXTERNAL_ACTIVATION_LOCKED", "An integration account cannot become active until automated credential health checks and its reviewed adapter are implemented.", 409);
  const { accountId } = await context.params; const existing = await prisma.integrationAccount.findUnique({ where: { id: accountId }, include: { sourcePlatform: { select: { code: true } } } }); if (!existing) return apiError("INTEGRATION_ACCOUNT_NOT_FOUND", "Integration account was not found.", 404);
  const { secretReference, ...safeChanges } = parsed.data;
  const account = await prisma.$transaction(async (tx) => { const updated = await tx.integrationAccount.update({ where: { id: accountId }, data: { ...safeChanges, ...(secretReference ? { secretReference, isHealthy: false, lastHealthCheckAt: null, lastHealthStatus: "Credential reference changed; health check required" } : {}) } }); await tx.auditLog.create({ data: { actorId: session.userId, action: "integration_account.settings_changed", entityType: "IntegrationAccount", entityId: accountId, metadata: { platformCode: existing.sourcePlatform.code, accountKey: existing.accountKey, changed: { ...safeChanges, secretReferenceChanged: Boolean(secretReference) } } } }); return updated; });
  return apiSuccess({ account: { ...account, secretReference: "secret://••••••••" }, activationLocked: true });
}
