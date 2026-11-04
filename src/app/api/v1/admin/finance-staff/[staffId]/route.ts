import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";

export async function DELETE(request: NextRequest, context: { params: Promise<{ staffId: string }> }) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") return apiError("ADMIN_ACCESS_REQUIRED", "Administrator access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "This access change must originate from the protected Admin application.", 403);
  const { staffId } = await context.params;
  const assignment = await prisma.userRole.findFirst({ where: { userId: staffId, role: { code: ROLE.FINANCE }, user: { deletedAt: null } }, select: { userId: true, roleId: true, user: { select: { personCode: true, fullName: true, email: true } } } });
  if (!assignment) return apiError("FINANCE_STAFF_NOT_FOUND", "Finance access was not found for this account.", 404);
  const now = new Date();
  const revokedSessions = await prisma.$transaction(async (tx) => { await tx.userRole.delete({ where: { userId_roleId: { userId: assignment.userId, roleId: assignment.roleId } } }); const revoked = await tx.authSession.updateMany({ where: { userId: assignment.userId, portal: "finance", revokedAt: null, expiresAt: { gt: now } }, data: { revokedAt: now } }); await tx.auditLog.create({ data: { actorId: session.userId, action: "finance.staff_role_revoked", entityType: "User", entityId: assignment.userId, metadata: { revokedSessions: revoked.count } } }); return revoked.count; });
  return apiSuccess({ staff: assignment.user, revokedSessions }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
