import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";

const createCountrySchema = z.object({
  isoCode: z.string().trim().length(2).toUpperCase(),
  name: z.string().trim().min(2).max(80),
  defaultCurrency: z.string().trim().length(3).toUpperCase(),
  defaultLocale: z.string().trim().min(2).max(10).default("en"),
  isActive: z.boolean().default(false),
});

function hasAdminAccess(roles: string[]) {
  return roles.includes(ROLE.ADMIN);
}

export async function GET(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session || !hasAdminAccess(session.roles)) return apiError("ADMIN_ACCESS_REQUIRED", "Admin access is required.", 403);
  const countries = await prisma.country.findMany({ orderBy: [{ isActive: "desc" }, { name: "asc" }], include: { originLanes: { select: { id: true, isActive: true } } } });
  return apiSuccess({ countries: countries.map(({ originLanes, ...country }) => ({ ...country, activeOriginLaneCount: originLanes.filter((lane) => lane.isActive).length })) });
}

export async function POST(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session || !hasAdminAccess(session.roles)) return apiError("ADMIN_ACCESS_REQUIRED", "Admin access is required.", 403);
  const parsed = createCountrySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Please provide a valid country code, name, currency, and locale.", 422, z.treeifyError(parsed.error));
  try {
    const country = await prisma.$transaction(async (tx) => {
      const created = await tx.country.create({ data: parsed.data });
      await tx.auditLog.create({ data: { actorId: session.userId, action: "country.created", entityType: "Country", entityId: created.id, metadata: { isoCode: created.isoCode, isActive: created.isActive } } });
      return created;
    });
    return apiSuccess({ country }, { status: 201 });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return apiError("COUNTRY_ALREADY_EXISTS", "This country code already exists.", 409);
    throw error;
  }
}
