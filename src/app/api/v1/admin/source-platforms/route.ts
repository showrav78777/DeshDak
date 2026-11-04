import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";

const schema = z.object({ code: z.string().trim().toUpperCase().min(2).max(50).regex(/^[A-Z0-9_]+$/), displayName: z.string().trim().min(2).max(100), adapterKey: z.preprocess((value) => value === "" || value === null ? null : value, z.string().trim().toUpperCase().max(80).regex(/^[A-Z0-9_]+$/).nullable()), supportedCountries: z.array(z.string().trim().length(2).toUpperCase()).max(50).default([]), supportsSearch: z.boolean().default(false), supportsOrders: z.boolean().default(false), supportsTracking: z.boolean().default(false), supportsCancellation: z.boolean().default(false), isActive: z.boolean().default(false) }).strict();

export async function GET(request: NextRequest) {
  const session = await getRequestSession(request); if (!session?.roles.includes(ROLE.ADMIN)) return apiError("ADMIN_ACCESS_REQUIRED", "Admin access is required.", 403);
  const platforms = await prisma.sourcePlatform.findMany({ include: { integrationAccounts: { orderBy: [{ countryCode: "asc" }, { accountKey: "asc" }] } }, orderBy: { displayName: "asc" } });
  return apiSuccess({ platforms: platforms.map((platform) => ({ ...platform, integrationAccounts: platform.integrationAccounts.map((account) => ({ ...account, secretReference: account.secretReference ? "secret://••••••••" : null })) })) });
}

export async function POST(request: NextRequest) {
  const session = await getRequestSession(request); if (!session?.roles.includes(ROLE.ADMIN)) return apiError("ADMIN_ACCESS_REQUIRED", "Admin access is required.", 403);
  const parsed = schema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Provide valid source-platform settings.", 422);
  if (parsed.data.isActive) return apiError("PLATFORM_MUST_START_INACTIVE", "New source integrations must start inactive.", 422);
  if (parsed.data.supportedCountries.length) { const count = await prisma.country.count({ where: { isoCode: { in: parsed.data.supportedCountries } } }); if (count !== new Set(parsed.data.supportedCountries).size) return apiError("COUNTRY_CONFIGURATION_REQUIRED", "Configure every supported country before adding it to a source integration.", 422); }
  try { const platform = await prisma.$transaction(async (tx) => { const created = await tx.sourcePlatform.create({ data: parsed.data }); await tx.auditLog.create({ data: { actorId: session.userId, action: "source_platform.created", entityType: "SourcePlatform", entityId: created.id, metadata: { code: created.code, adapterKey: created.adapterKey, supportedCountries: created.supportedCountries, capabilities: { search: created.supportsSearch, orders: created.supportsOrders, tracking: created.supportsTracking, cancellation: created.supportsCancellation }, isActive: false } } }); return created; }); return apiSuccess({ platform }, { status: 201 }); }
  catch (error) { if ((error as { code?: string }).code === "P2002") return apiError("SOURCE_PLATFORM_EXISTS", "This source-platform code already exists.", 409); throw error; }
}
