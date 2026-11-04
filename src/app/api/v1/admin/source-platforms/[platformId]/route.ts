import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";

const schema = z.object({ displayName: z.string().trim().min(2).max(100).optional(), adapterKey: z.preprocess((value) => value === "" || value === null ? null : value, z.string().trim().toUpperCase().max(80).regex(/^[A-Z0-9_]+$/).nullable()).optional(), supportedCountries: z.array(z.string().trim().length(2).toUpperCase()).max(50).optional(), supportsSearch: z.boolean().optional(), supportsOrders: z.boolean().optional(), supportsTracking: z.boolean().optional(), supportsCancellation: z.boolean().optional(), isActive: z.boolean().optional() }).strict().refine((value) => Object.keys(value).length > 0, "Provide at least one source-platform setting.");

export async function PATCH(request: NextRequest, context: { params: Promise<{ platformId: string }> }) {
  const session = await getRequestSession(request); if (!session?.roles.includes(ROLE.ADMIN)) return apiError("ADMIN_ACCESS_REQUIRED", "Admin access is required.", 403);
  const parsed = schema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Provide valid source-platform settings.", 422);
  const { platformId } = await context.params; const existing = await prisma.sourcePlatform.findUnique({ where: { id: platformId }, include: { integrationAccounts: { select: { isActive: true, isHealthy: true } } } }); if (!existing) return apiError("SOURCE_PLATFORM_NOT_FOUND", "Source platform was not found.", 404);
  if (parsed.data.isActive === true && existing.code !== "LOCAL_SELLER") return apiError("EXTERNAL_ACTIVATION_LOCKED", "External source activation requires an implemented adapter, automated credential health check, risk screening, and operations approval.", 409);
  if (parsed.data.isActive === false && existing.integrationAccounts.some((account) => account.isActive)) return apiError("ACTIVE_ACCOUNTS_EXIST", "Disable active integration accounts before disabling the source platform.", 409);
  if (parsed.data.supportedCountries) { const count = await prisma.country.count({ where: { isoCode: { in: parsed.data.supportedCountries } } }); if (count !== new Set(parsed.data.supportedCountries).size) return apiError("COUNTRY_CONFIGURATION_REQUIRED", "Configure every supported country before adding it to a source integration.", 422); }
  const platform = await prisma.$transaction(async (tx) => { const updated = await tx.sourcePlatform.update({ where: { id: platformId }, data: parsed.data }); await tx.auditLog.create({ data: { actorId: session.userId, action: "source_platform.settings_changed", entityType: "SourcePlatform", entityId: platformId, metadata: { code: existing.code, changed: parsed.data } } }); return updated; });
  return apiSuccess({ platform, activationLocked: platform.code !== "LOCAL_SELLER" });
}
