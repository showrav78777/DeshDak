import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { parseAuditQuery, queryAuditEvents } from "@/modules/audit/query";

export async function GET(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN)) return apiError("ADMIN_ACCESS_REQUIRED", "Administrator access is required.", 403);
  const result = await queryAuditEvents(prisma, parseAuditQuery(request.nextUrl.searchParams));
  return apiSuccess(result, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
