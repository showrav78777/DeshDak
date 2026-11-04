import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { supportHolidaySchema } from "@/modules/support/schemas";

export async function POST(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") return apiError("ADMIN_ACCESS_REQUIRED", "Admin access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "This calendar update must originate from the protected Admin application.", 403);
  const parsed = supportHolidaySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Check the holiday.", 422);
  const date = new Date(`${parsed.data.date}T00:00:00.000Z`);
  try {
    const holiday = await prisma.$transaction(async (tx) => { const saved = await tx.supportHoliday.create({ data: { date, name: parsed.data.name } }); await tx.auditLog.create({ data: { actorId: session.userId, action: "support.holiday_created", entityType: "SupportHoliday", entityId: saved.id, metadata: { date: parsed.data.date, name: saved.name } } }); return saved; });
    return apiSuccess({ holiday }, { status: 201 });
  } catch (error) { if ((error as { code?: string }).code === "P2002") return apiError("SUPPORT_HOLIDAY_EXISTS", "A support holiday already exists on this date.", 409); throw error; }
}
