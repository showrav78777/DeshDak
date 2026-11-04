import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { recordUserEvent } from "@/modules/activity/service";

const idSchema = z.string().uuid();

export async function DELETE(request: NextRequest, context: RouteContext<"/api/v1/auth/sessions/[sessionId]">) {
  if (!hasTrustedMutationOrigin(request)) return apiError("INVALID_ORIGIN", "The request origin could not be verified.", 403);
  const session = await getRequestSession(request);
  if (!session) return apiError("AUTHENTICATION_REQUIRED", "Sign in to manage your sessions.", 401);
  const parsedId = idSchema.safeParse((await context.params).sessionId);
  if (!parsedId.success) return apiError("VALIDATION_ERROR", "Choose a valid session.", 422);
  if (parsedId.data === session.sessionId) return apiError("CURRENT_SESSION_PROTECTED", "Use Sign out to close the browser you are currently using.", 409);
  const target = await prisma.authSession.findFirst({ where: { id: parsedId.data, userId: session.userId }, select: { id: true, revokedAt: true, expiresAt: true, clientName: true, clientType: true } });
  if (!target) return apiError("SESSION_NOT_FOUND", "That session was not found.", 404);
  if (target.revokedAt || target.expiresAt <= new Date()) return apiError("SESSION_NOT_ACTIVE", "That session is already inactive.", 409);
  const revokedAt = new Date();
  const revoked = await prisma.$transaction(async (tx) => {
    const result = await tx.authSession.updateMany({ where: { id: target.id, userId: session.userId, revokedAt: null, expiresAt: { gt: revokedAt } }, data: { revokedAt } });
    if (!result.count) return false;
    await tx.auditLog.create({ data: { actorId: session.userId, action: "auth.session_revoked_remotely", entityType: "AuthSession", entityId: target.id, metadata: { initiatedBySessionId: session.sessionId, clientName: target.clientName, clientType: target.clientType } } });
    await recordUserEvent(tx, { userId: session.userId, authSessionId: session.sessionId, category: "SECURITY", eventType: "AUTH_SESSION_REVOKED_REMOTELY", objectType: "AuthSession", objectId: target.id, metadata: { clientName: target.clientName, clientType: target.clientType } });
    return true;
  });
  if (!revoked) return apiError("SESSION_NOT_ACTIVE", "That session is already inactive.", 409);
  return apiSuccess({ sessionId: target.id, revokedAt: revokedAt.toISOString() });
}
