import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { suppressionQuery, suppressionSelect } from "@/modules/notifications/suppression-review";

export async function GET(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin" || !session.mfaVerifiedAt) return apiError("ADMIN_MFA_REQUIRED", "Administrator access with completed MFA is required.", 403);
  const parsed = suppressionQuery.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Choose an active or released list and a valid page.", 422);
  const { page, state } = parsed.data;
  const items = await prisma.emailSuppression.findMany({ where: { active: state === "active" }, select: suppressionSelect, orderBy: [{ lastSeenAt: "desc" }, { id: "asc" }], skip: (page - 1) * 50, take: 51 });
  return apiSuccess({ items: items.slice(0, 50), page, hasMore: items.length > 50 }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
