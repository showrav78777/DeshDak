import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { supportShiftSchema } from "@/modules/support/schemas";

export async function POST(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") return apiError("ADMIN_ACCESS_REQUIRED", "Admin access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "This rota update must originate from the protected Admin application.", 403);
  const parsed = supportShiftSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Check the shift.", 422);
  const result = await prisma.$transaction(async (tx) => {
    // Share the assignment/revocation lock so eligibility and overlap cannot
    // become stale between checking the calendar and inserting a shift.
    await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended('crossly:support-assignment', 0))");
    const agent = await tx.user.findFirst({ where: { id: parsed.data.agentId, deletedAt: null, status: "ACTIVE", roles: { some: { role: { code: ROLE.CUSTOMER_SERVICE } } } }, select: { id: true } });
    if (!agent) return { kind: "missing" as const };
    const overlap = await tx.supportShift.count({ where: { agentId: agent.id, status: "SCHEDULED", startsAt: { lt: parsed.data.endsAt }, endsAt: { gt: parsed.data.startsAt } } });
    if (overlap) return { kind: "overlap" as const };
    const shift = await tx.supportShift.create({ data: { agentId: agent.id, startsAt: parsed.data.startsAt, endsAt: parsed.data.endsAt, note: parsed.data.note, createdById: session.userId } });
    await tx.auditLog.create({ data: { actorId: session.userId, action: "support.shift_created", entityType: "SupportShift", entityId: shift.id, metadata: { agentId: shift.agentId, startsAt: shift.startsAt.toISOString(), endsAt: shift.endsAt.toISOString() } } });
    return { kind: "created" as const, shift };
  });
  if (result.kind === "missing") return apiError("SUPPORT_AGENT_NOT_FOUND", "The selected Customer Service agent is not active.", 404);
  if (result.kind === "overlap") return apiError("SUPPORT_SHIFT_OVERLAP", "This agent already has an overlapping scheduled shift.", 409);
  return apiSuccess({ shift: result.shift }, { status: 201 });
}
