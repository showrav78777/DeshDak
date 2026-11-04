import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { lockSourcingStaffAccess } from "@/modules/sourcing/staff-access-lock";

const schema = z.object({ email: z.string().trim().email().transform((value) => value.toLowerCase()) });
export async function GET(request: NextRequest) { const session = await getRequestSession(request); if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") return apiError("ADMIN_ACCESS_REQUIRED", "Administrator access is required.", 403); const staff = await prisma.user.findMany({ where: { deletedAt: null, roles: { some: { role: { code: ROLE.SOURCING_AGENT } } } }, select: { id: true, personCode: true, fullName: true, email: true, status: true, authSessions: { where: { portal: "sourcing", revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true } } }, orderBy: { fullName: "asc" } }); return apiSuccess({ staff: staff.map(({ authSessions, ...item }) => ({ ...item, activeSessions: authSessions.length })) }, { headers: { "Cache-Control": "private, no-store, max-age=0" } }); }
export async function POST(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") return apiError("ADMIN_ACCESS_REQUIRED", "Administrator access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "This role assignment must originate from Admin.", 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Enter an existing verified account email.", 422);
  const [candidate, role] = await Promise.all([
    prisma.user.findFirst({ where: { email: parsed.data.email, deletedAt: null, status: "ACTIVE" }, select: { id: true } }),
    prisma.role.findUnique({ where: { code: ROLE.SOURCING_AGENT }, select: { id: true } }),
  ]);
  if (!candidate) return apiError("ACTIVE_USER_NOT_FOUND", "Create and verify the staff account first.", 404);
  if (!role) return apiError("ROLE_CONFIGURATION_MISSING", "Sourcing Agent role is missing.", 503);
  const user = await prisma.$transaction(async tx => {
    await lockSourcingStaffAccess(tx, candidate.id);
    const current = await tx.user.findFirst({ where: { id: candidate.id, email: parsed.data.email, deletedAt: null, status: "ACTIVE" }, select: { id: true, personCode: true, fullName: true, email: true } });
    if (!current) return null;
    const created = await tx.userRole.createMany({ data: [{ userId: current.id, roleId: role.id }], skipDuplicates: true });
    if (created.count) await tx.auditLog.create({ data: { actorId: session.userId, action: "sourcing.staff_role_granted", entityType: "User", entityId: current.id, metadata: { email: current.email } } });
    return current;
  });
  if (!user) return apiError("ACTIVE_USER_NOT_FOUND", "Create and verify the staff account first.", 404);
  return apiSuccess({ staff: user }, { status: 201, headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
