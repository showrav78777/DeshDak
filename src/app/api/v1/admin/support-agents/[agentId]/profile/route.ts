import { type NextRequest } from "next/server";

import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { supportAgentProfileSchema } from "@/modules/support/schemas";

export async function PUT(request: NextRequest, context: RouteContext<"/api/v1/admin/support-agents/[agentId]/profile">) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") return apiError("ADMIN_ACCESS_REQUIRED", "Admin access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "This workforce update must originate from the protected Admin application.", 403);
  const parsed = supportAgentProfileSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Check the support profile.", 422);
  const { agentId } = await context.params;
  const agent = await prisma.user.findFirst({ where: { id: agentId, deletedAt: null, status: "ACTIVE", roles: { some: { role: { code: ROLE.CUSTOMER_SERVICE } } } }, select: { id: true, fullName: true, supportAgentProfile: { select: { version: true } } } });
  if (!agent) return apiError("SUPPORT_AGENT_NOT_FOUND", "The selected Customer Service agent is not active.", 404);
  if (agent.supportAgentProfile && parsed.data.version !== agent.supportAgentProfile.version) return apiError("SUPPORT_PROFILE_CHANGED", "This support profile changed after the page loaded. Refresh before saving.", 409);
  if (!agent.supportAgentProfile && parsed.data.version) return apiError("SUPPORT_PROFILE_CHANGED", "Refresh before creating this support profile.", 409);
  const changes = { availability: parsed.data.availability, acceptingNewTickets: parsed.data.acceptingNewTickets, maxActiveTickets: parsed.data.maxActiveTickets, languages: parsed.data.languages, statusNote: parsed.data.statusNote };
  const profile = await prisma.$transaction(async (tx) => {
    if (agent.supportAgentProfile) {
      const changed = await tx.supportAgentProfile.updateMany({ where: { userId: agent.id, version: agent.supportAgentProfile.version }, data: { ...changes, updatedById: session.userId, version: { increment: 1 } } });
      if (changed.count !== 1) return null;
    } else {
      await tx.supportAgentProfile.create({ data: { userId: agent.id, ...changes, updatedById: session.userId } });
    }
    const saved = await tx.supportAgentProfile.findUniqueOrThrow({ where: { userId: agent.id } });
    await tx.auditLog.create({ data: { actorId: session.userId, action: "support.agent_profile_changed", entityType: "SupportAgentProfile", entityId: agent.id, metadata: { availability: saved.availability, acceptingNewTickets: saved.acceptingNewTickets, maxActiveTickets: saved.maxActiveTickets, languages: saved.languages, version: saved.version } } });
    return saved;
  });
  if (!profile) return apiError("SUPPORT_PROFILE_CHANGED", "This support profile changed while saving. Refresh and review it.", 409);
  return apiSuccess({ agent: { id: agent.id, fullName: agent.fullName }, profile }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
