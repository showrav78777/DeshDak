import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";

export async function GET(request: NextRequest) {
  const session = await getRequestSession(request); if (!session?.roles.includes(ROLE.KAM) || session.portal !== "sales") return apiError("KAM_ACCESS_REQUIRED", "Key Account Manager access is required.", 403);
  const now = new Date();
  const accounts = await prisma.businessAccount.findMany({ where: { status: "ACTIVE", assignments: { some: { userId: session.userId, isActive: true } } }, select: { id: true, accountCode: true, organizationName: true, status: true, owner: { select: { personCode: true, fullName: true, email: true, phone: true, residenceCountryCode: true } }, _count: { select: { activities: true } }, activities: { where: { followUpAt: { not: null } }, select: { followUpAt: true }, orderBy: { followUpAt: "asc" }, take: 1 }, }, orderBy: { organizationName: "asc" } });
  return apiSuccess({ accounts: accounts.map((account) => ({ ...account, nextFollowUpAt: account.activities[0]?.followUpAt ?? null, followUpOverdue: Boolean(account.activities[0]?.followUpAt && account.activities[0].followUpAt < now), activities: undefined })) }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
