import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { lockSourcingStaffAccess } from "@/modules/sourcing/staff-access-lock";

export async function DELETE(request: NextRequest, context: { params: Promise<{ staffId: string }> }) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") return apiError("ADMIN_ACCESS_REQUIRED", "Administrator access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "This access change must originate from Admin.", 403);
  const { staffId } = await context.params;
  const result = await prisma.$transaction(async tx => {
    await lockSourcingStaffAccess(tx, staffId);
    const assignment = await tx.userRole.findFirst({ where: { userId: staffId, role: { code: ROLE.SOURCING_AGENT }, user: { deletedAt: null } }, select: { userId: true, roleId: true, user: { select: { personCode: true, fullName: true, email: true } } } });
    if (!assignment) return null;
    await tx.userRole.delete({ where: { userId_roleId: { userId: assignment.userId, roleId: assignment.roleId } } });
    const now = new Date();
    const revoked = await tx.authSession.updateMany({ where: { userId: assignment.userId, portal: "sourcing", revokedAt: null, expiresAt: { gt: now } }, data: { revokedAt: now } });
    await tx.auditLog.create({ data: { actorId: session.userId, action: "sourcing.staff_role_revoked", entityType: "User", entityId: assignment.userId, metadata: { revokedSessions: revoked.count } } });
    return { staff: assignment.user, revokedSessions: revoked.count };
  });
  if (!result) return apiError("SOURCING_STAFF_NOT_FOUND", "Sourcing access was not found.", 404);
  return apiSuccess(result, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
