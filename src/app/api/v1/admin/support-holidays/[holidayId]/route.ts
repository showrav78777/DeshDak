import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";

export async function DELETE(request: NextRequest, context: RouteContext<"/api/v1/admin/support-holidays/[holidayId]">) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") return apiError("ADMIN_ACCESS_REQUIRED", "Admin access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "This calendar update must originate from the protected Admin application.", 403);
  const { holidayId } = await context.params;
  const removed = await prisma.$transaction(async (tx) => {
    const holiday = await tx.supportHoliday.findUnique({ where: { id: holidayId } });
    if (!holiday) return false;
    // A concurrent removal can win after the read. Only the request that
    // actually deletes the row may record the removal audit.
    const result = await tx.supportHoliday.deleteMany({ where: { id: holiday.id } });
    if (result.count !== 1) return false;
    await tx.auditLog.create({ data: { actorId: session.userId, action: "support.holiday_removed", entityType: "SupportHoliday", entityId: holiday.id, metadata: { date: holiday.date.toISOString().slice(0, 10), name: holiday.name } } });
    return true;
  });
  if (!removed) return apiError("SUPPORT_HOLIDAY_NOT_FOUND", "Support holiday was not found.", 404);
  return apiSuccess({ removed: true });
}
