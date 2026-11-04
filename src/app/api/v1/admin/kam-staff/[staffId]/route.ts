import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";

export async function DELETE(request: NextRequest, context: RouteContext<"/api/v1/admin/kam-staff/[staffId]">) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") return apiError("ADMIN_ACCESS_REQUIRED", "Administrator access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "This access change must originate from Admin.", 403);
  const { staffId } = await context.params;
  const assignment = await prisma.userRole.findFirst({ where: { userId: staffId, role: { code: ROLE.KAM }, user: { deletedAt: null } }, select: { userId: true, roleId: true, user: { select: { personCode: true, fullName: true, email: true } } } });
  if (!assignment) return apiError("KAM_STAFF_NOT_FOUND", "KAM access was not found.", 404);
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => { const accounts = await tx.kamAssignment.updateMany({ where: { userId: staffId, isActive: true }, data: { isActive: false, deactivatedAt: now } }); await tx.userRole.delete({ where: { userId_roleId: { userId: staffId, roleId: assignment.roleId } } }); const sessions = await tx.authSession.updateMany({ where: { userId: staffId, portal: "sales", revokedAt: null }, data: { revokedAt: now } }); await tx.auditLog.create({ data: { actorId: session.userId, action: "sales.kam_role_revoked", entityType: "User", entityId: staffId, metadata: { assignmentsDeactivated: accounts.count, sessionsRevoked: sessions.count } } }); return { assignmentsDeactivated: accounts.count, sessionsRevoked: sessions.count }; });
  return apiSuccess({ staff: assignment.user, ...result }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
