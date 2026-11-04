import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { complianceStaffAssignmentSchema } from "@/modules/compliance/schemas";

export async function GET(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") return apiError("ADMIN_ACCESS_REQUIRED", "Administrator access is required.", 403);
  const staff = await prisma.user.findMany({ where: { deletedAt: null, roles: { some: { role: { code: ROLE.COMPLIANCE } } } }, select: { id: true, personCode: true, fullName: true, email: true, status: true, mfaMethod: { select: { enabledAt: true } }, authSessions: { where: { portal: "compliance", revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true } } }, orderBy: { fullName: "asc" } });
  return apiSuccess({ staff: staff.map(({ authSessions, ...item }) => ({ ...item, activeSessions: authSessions.length })) }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function POST(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") return apiError("ADMIN_ACCESS_REQUIRED", "Administrator access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "This role assignment must originate from the protected Admin application.", 403);
  const parsed = complianceStaffAssignmentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Enter the exact email of an existing verified staff account.", 422);
  const [user, role] = await Promise.all([prisma.user.findFirst({ where: { email: parsed.data.email, deletedAt: null, status: "ACTIVE" }, select: { id: true, personCode: true, fullName: true, email: true } }), prisma.role.findUnique({ where: { code: ROLE.COMPLIANCE }, select: { id: true } })]);
  if (!user) return apiError("ACTIVE_USER_NOT_FOUND", "Create and verify the staff account before granting Compliance access.", 404);
  if (!role) return apiError("ROLE_CONFIGURATION_MISSING", "Deploy the compliance-role migration before granting access.", 503);
  await prisma.$transaction(async (tx) => {
    await tx.userRole.upsert({ where: { userId_roleId: { userId: user.id, roleId: role.id } }, update: {}, create: { userId: user.id, roleId: role.id } });
    await tx.auditLog.create({ data: { actorId: session.userId, action: "compliance.staff_role_granted", entityType: "User", entityId: user.id, metadata: { email: user.email } } });
  });
  return apiSuccess({ staff: user }, { status: 201, headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
