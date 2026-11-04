import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";

export async function DELETE(request: NextRequest, context: RouteContext<"/api/v1/admin/support-shifts/[shiftId]">) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") return apiError("ADMIN_ACCESS_REQUIRED", "Admin access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "This rota update must originate from the protected Admin application.", 403);
  const { shiftId } = await context.params;
  const result = await prisma.$transaction(async (tx) => {
    // Re-read after the same lock used by shift creation and assignment. Only
    // the first cancellation changes state and writes an audit entry.
    await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended('crossly:support-assignment', 0))");
    const shift = await tx.supportShift.findUnique({ where: { id: shiftId } });
    if (!shift) return null;
    if (shift.status === "CANCELLED") return { shift, idempotentReplay: true };
    const cancelled = await tx.supportShift.update({ where: { id: shift.id }, data: { status: "CANCELLED" } });
    await tx.auditLog.create({ data: { actorId: session.userId, action: "support.shift_cancelled", entityType: "SupportShift", entityId: shift.id, metadata: { agentId: shift.agentId, startsAt: shift.startsAt.toISOString(), endsAt: shift.endsAt.toISOString() } } });
    return { shift: cancelled, idempotentReplay: false };
  });
  if (!result) return apiError("SUPPORT_SHIFT_NOT_FOUND", "Support shift was not found.", 404);
  return apiSuccess(result);
}
