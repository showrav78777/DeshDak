import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { recordUserEvent } from "@/modules/activity/service";

export async function POST(request: NextRequest) {
  if (!hasTrustedMutationOrigin(request)) return apiError("INVALID_ORIGIN", "The request origin could not be verified.", 403);
  const session = await getRequestSession(request);
  if (!session) return apiError("AUTHENTICATION_REQUIRED", "Sign in to manage your sessions.", 401);
  const revokedAt = new Date();
  const revokedCount = await prisma.$transaction(async (tx) => {
    const revoked = await tx.authSession.updateMany({ where: { userId: session.userId, id: { not: session.sessionId }, revokedAt: null, expiresAt: { gt: revokedAt } }, data: { revokedAt } });
    await tx.auditLog.create({ data: { actorId: session.userId, action: "auth.other_sessions_revoked", entityType: "User", entityId: session.userId, metadata: { initiatedBySessionId: session.sessionId, revokedCount: revoked.count } } });
    await recordUserEvent(tx, { userId: session.userId, authSessionId: session.sessionId, category: "SECURITY", eventType: "AUTH_OTHER_SESSIONS_REVOKED", objectType: "User", objectId: session.userId, metadata: { revokedCount: revoked.count } });
    return revoked.count;
  });
  return apiSuccess({ revokedCount, currentSessionId: session.sessionId });
}
