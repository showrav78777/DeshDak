import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";

const optionalDay = z.preprocess((value) => value === "" || value === undefined ? undefined : value, z.coerce.number().int().min(1).max(365).optional());
const optionalEstimate = z.preprocess((value) => value === "" || value === undefined ? null : value, z.coerce.number().min(0).max(1_000_000).nullable().optional());
// A same-country lane is a valid last-mile courier service (for example Bangladesh → Bangladesh).
const schema = z.object({ originCountryId: z.string().uuid(), destinationCountryId: z.string().uuid(), name: z.string().trim().min(3).max(100), dimensionalWeightDivisor: z.coerce.number().int().min(1_000).max(10_000), weightDiscrepancyThresholdPercent: z.coerce.number().min(0).max(1000).default(10), estimatedRatePerKgBdt: optionalEstimate, estimatedLastMileRatePerKgBdt: optionalEstimate, estimatedHandlingFeeBdt: optionalEstimate, estimatedMinimumChargeBdt: optionalEstimate, transitDaysMin: optionalDay, transitDaysMax: optionalDay }).refine((value) => !value.transitDaysMin || !value.transitDaysMax || value.transitDaysMax >= value.transitDaysMin, { message: "Maximum transit days must not be less than minimum transit days." });

export async function POST(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN)) return apiError("ADMIN_ACCESS_REQUIRED", "Admin access is required.", 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Please check the shipping lane details.", 422, z.treeifyError(parsed.error));
  const countryCount = await prisma.country.count({ where: { id: { in: [parsed.data.originCountryId, parsed.data.destinationCountryId] } } });
  if (countryCount !== 2) return apiError("COUNTRY_NOT_FOUND", "Choose configured origin and destination countries.", 422);
  try {
    const lane = await prisma.$transaction(async (tx) => {
      const created = await tx.shippingLane.create({ data: { ...parsed.data, isActive: false } });
      await tx.auditLog.create({ data: { actorId: session.userId, action: "shipping_lane.created", entityType: "ShippingLane", entityId: created.id, metadata: { originCountryId: created.originCountryId, destinationCountryId: created.destinationCountryId, name: created.name } } });
      return created;
    });
    return apiSuccess({ lane }, { status: 201 });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return apiError("SHIPPING_LANE_ALREADY_EXISTS", "A lane with this name already exists for that route.", 409);
    throw error;
  }
}
