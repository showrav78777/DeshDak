import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { businessAccountAssignmentSchema } from "@/modules/sales/schemas";

export async function GET(request: NextRequest) {
  const session = await getRequestSession(request); if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") return apiError("ADMIN_ACCESS_REQUIRED", "Administrator access is required.", 403);
  const accounts = await prisma.businessAccount.findMany({ select: { id: true, accountCode: true, organizationName: true, status: true, version: true, owner: { select: { personCode: true, fullName: true, email: true, residenceCountryCode: true } }, assignments: { where: { isActive: true }, select: { id: true, role: true, user: { select: { id: true, personCode: true, fullName: true, email: true } } }, orderBy: { assignedAt: "desc" } }, _count: { select: { activities: true } } }, orderBy: { createdAt: "desc" }, take: 200 });
  return apiSuccess({ accounts }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function POST(request: NextRequest) {
  const session = await getRequestSession(request); if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") return apiError("ADMIN_ACCESS_REQUIRED", "Administrator access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "Account assignment must originate from Admin.", 403);
  const parsed = businessAccountAssignmentSchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return apiError("VALIDATION_ERROR", "Check the organization, business customer, and KAM email.", 422, { fields: parsed.error.flatten().fieldErrors });
  const [customer, kam] = await Promise.all([prisma.user.findFirst({ where: { email: parsed.data.customerEmail, accountType: "BUSINESS", status: "ACTIVE", deletedAt: null }, select: { id: true, personCode: true, fullName: true } }), prisma.user.findFirst({ where: { email: parsed.data.kamEmail, status: "ACTIVE", deletedAt: null, roles: { some: { role: { code: ROLE.KAM } } } }, select: { id: true, personCode: true, fullName: true } })]);
  if (!customer) return apiError("BUSINESS_CUSTOMER_NOT_FOUND", "An active verified Business customer is required.", 404);
  if (!kam) return apiError("KAM_NOT_FOUND", "Grant KAM access to this staff account first.", 404);
  const saved = await prisma.$transaction(async (tx) => { const account = await tx.businessAccount.upsert({ where: { ownerId: customer.id }, update: { organizationName: parsed.data.organizationName, status: "ACTIVE", version: { increment: 1 } }, create: { ownerId: customer.id, organizationName: parsed.data.organizationName } }); await tx.kamAssignment.updateMany({ where: { accountId: account.id, role: "PRIMARY", isActive: true, userId: { not: kam.id } }, data: { isActive: false, deactivatedAt: new Date() } }); const assignment = await tx.kamAssignment.upsert({ where: { accountId_userId: { accountId: account.id, userId: kam.id } }, update: { role: "PRIMARY", isActive: true, deactivatedAt: null, assignedById: session.userId, assignedAt: new Date() }, create: { accountId: account.id, userId: kam.id, role: "PRIMARY", assignedById: session.userId } }); await tx.auditLog.create({ data: { actorId: session.userId, action: "sales.business_account_assigned", entityType: "BusinessAccount", entityId: account.id, metadata: { accountCode: account.accountCode, customerPersonCode: customer.personCode, kamPersonCode: kam.personCode } } }); return { account, assignment }; });
  return apiSuccess({ account: { id: saved.account.id, accountCode: saved.account.accountCode, organizationName: saved.account.organizationName, status: saved.account.status, version: saved.account.version, owner: customer, primaryKam: kam } }, { status: 201, headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
