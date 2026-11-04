import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session) return apiError("AUTHENTICATION_REQUIRED", "Sign in to review your sessions.", 401);
  const sessions = await prisma.authSession.findMany({
    where: { userId: session.userId },
    select: { id: true, portal: true, clientName: true, clientType: true, createdAt: true, lastSeenAt: true, expiresAt: true, revokedAt: true },
    orderBy: { lastSeenAt: "desc" },
    take: 25,
  });
  const now = new Date();
  const response = apiSuccess({ sessions: sessions.map((item) => ({ ...item, isCurrent: item.id === session.sessionId, isActive: !item.revokedAt && item.expiresAt > now })) });
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}
