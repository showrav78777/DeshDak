import { type NextRequest } from "next/server";

import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { ACTIVE_TICKET_STATUSES } from "@/modules/support/policy";

export async function DELETE(request: NextRequest, context: RouteContext<"/api/v1/admin/support-agents/[agentId]">) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") return apiError("ADMIN_ACCESS_REQUIRED", "Admin access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "This access change must originate from the protected Admin application.", 403);
  const { agentId } = await context.params;
  const result = await prisma.$transaction(async (tx) => {
    // Serialize with claim/assignment before checking active work. A pre-transaction
    // count can become stale while another request assigns a ticket to this agent.
    await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended('crossly:support-assignment', 0))");
    const assignment = await tx.userRole.findFirst({
      where: { userId: agentId, role: { code: ROLE.CUSTOMER_SERVICE }, user: { deletedAt: null } },
      select: { userId: true, roleId: true, user: { select: { fullName: true, email: true, _count: { select: { assignedSupportTickets: { where: { status: { in: ACTIVE_TICKET_STATUSES } } } } } } } },
    });
    if (!assignment) return { kind: "missing" as const };
    if (assignment.user._count.assignedSupportTickets > 0) return { kind: "active" as const, activeTickets: assignment.user._count.assignedSupportTickets };
    const now = new Date();
    await tx.userRole.delete({ where: { userId_roleId: { userId: assignment.userId, roleId: assignment.roleId } } });
    const revoked = await tx.authSession.updateMany({ where: { userId: assignment.userId, portal: "support", revokedAt: null, expiresAt: { gt: now } }, data: { revokedAt: now } });
    await tx.auditLog.create({ data: { actorId: session.userId, action: "support.agent_role_revoked", entityType: "User", entityId: assignment.userId, metadata: { revokedSessions: revoked.count } } });
    return { kind: "revoked" as const, agent: { id: assignment.userId, fullName: assignment.user.fullName, email: assignment.user.email }, revokedSessions: revoked.count };
  });
  if (result.kind === "missing") return apiError("SUPPORT_AGENT_NOT_FOUND", "Customer Service access was not found for this account.", 404);
  if (result.kind === "active") return apiError("SUPPORT_AGENT_HAS_ACTIVE_TICKETS", "Reassign or finish this agent's active tickets before removing access.", 409, { activeTickets: result.activeTickets });
  return apiSuccess({ agent: result.agent, revokedSessions: result.revokedSessions }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
