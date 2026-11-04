import { type NextRequest } from "next/server";

import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { DEFAULT_SUPPORT_POLICY, getSupportOperatingPolicy } from "@/modules/support/policy";
import { supportOperatingPolicySchema } from "@/modules/support/schemas";

export async function GET(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") return apiError("ADMIN_ACCESS_REQUIRED", "Admin access is required.", 403);
  const [policy, holidays, shifts] = await Promise.all([getSupportOperatingPolicy(prisma), prisma.supportHoliday.findMany({ orderBy: { date: "asc" }, take: 200 }), prisma.supportShift.findMany({ where: { endsAt: { gte: new Date() } }, include: { agent: { select: { id: true, fullName: true } } }, orderBy: { startsAt: "asc" }, take: 300 })]);
  return apiSuccess({ policy, holidays, shifts }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function PUT(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") return apiError("ADMIN_ACCESS_REQUIRED", "Admin access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "This policy update must originate from the protected Admin application.", 403);
  const parsed = supportOperatingPolicySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Check the support policy.", 422);
  const existing = await prisma.supportOperatingPolicy.findUnique({ where: { id: "default" }, select: { version: true } });
  if (existing && parsed.data.version !== existing.version) return apiError("SUPPORT_POLICY_CHANGED", "The support policy changed after the page loaded. Refresh before saving.", 409);
  if (!existing && parsed.data.version !== undefined && parsed.data.version !== DEFAULT_SUPPORT_POLICY.version) return apiError("SUPPORT_POLICY_CHANGED", "The support policy changed after the page loaded. Refresh before saving.", 409);
  const changes = { timeZone: parsed.data.timeZone, firstResponseBusinessDays: parsed.data.firstResponseBusinessDays, approachingHours: parsed.data.approachingHours, businessWeekdays: parsed.data.businessWeekdays, openingMinute: parsed.data.openingMinute, closingMinute: parsed.data.closingMinute, requireScheduledShift: parsed.data.requireScheduledShift };
  const policy = await prisma.$transaction(async (tx) => {
    if (existing) {
      const changed = await tx.supportOperatingPolicy.updateMany({ where: { id: "default", version: existing.version }, data: { ...changes, updatedById: session.userId, version: { increment: 1 } } });
      if (changed.count !== 1) return null;
    } else {
      // The default calendar is already exposed as version 1 before persistence.
      // Advance it on the first write, and let the unique ID arbitrate competing
      // initializers without surfacing a Prisma unique-constraint error.
      const created = await tx.supportOperatingPolicy.createMany({ data: [{ ...DEFAULT_SUPPORT_POLICY, ...changes, version: DEFAULT_SUPPORT_POLICY.version + 1, updatedById: session.userId }], skipDuplicates: true });
      if (created.count !== 1) return null;
    }
    const saved = await tx.supportOperatingPolicy.findUniqueOrThrow({ where: { id: "default" } });
    await tx.auditLog.create({ data: { actorId: session.userId, action: "support.operating_policy_changed", entityType: "SupportOperatingPolicy", entityId: saved.id, metadata: { timeZone: saved.timeZone, firstResponseBusinessDays: saved.firstResponseBusinessDays, approachingHours: saved.approachingHours, businessWeekdays: saved.businessWeekdays, openingMinute: saved.openingMinute, closingMinute: saved.closingMinute, requireScheduledShift: saved.requireScheduledShift, version: saved.version } } });
    return saved;
  });
  if (!policy) return apiError("SUPPORT_POLICY_CHANGED", "The support policy changed while saving. Refresh and review it.", 409);
  return apiSuccess({ policy }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
