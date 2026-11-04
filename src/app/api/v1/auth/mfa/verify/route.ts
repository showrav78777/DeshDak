import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { decryptMfaSecret, hashRecoveryCode, normalizeRecoveryCode, verifyTotp } from "@/lib/mfa";
import { getPendingPrivilegedSession, hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";

const schema = z.object({ code: z.string().trim().min(6).max(32) });
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

export async function POST(request: NextRequest) {
  if (!hasTrustedMutationOrigin(request)) return apiError("INVALID_ORIGIN", "The request origin could not be verified.", 403);
  const session = await getPendingPrivilegedSession(request);
  if (!session) return apiError("UNAUTHORIZED", "Sign in through an authorized privileged portal first.", 401);
  if (session.mfaVerifiedAt) return apiSuccess({ verifiedAt: session.mfaVerifiedAt.toISOString() });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Enter an authenticator or recovery code.", 422);
  const [authSession, method] = await Promise.all([
    prisma.authSession.findUnique({ where: { id: session.sessionId }, select: { mfaFailedAttempts: true, mfaLockedUntil: true } }),
    prisma.mfaMethod.findUnique({ where: { userId: session.userId } }),
  ]);
  if (!authSession || !method) return apiError("MFA_SETUP_REQUIRED", "Set up authenticator verification before continuing.", 409);
  if (authSession.mfaLockedUntil && authSession.mfaLockedUntil > new Date()) return apiError("MFA_TEMPORARILY_LOCKED", "Too many incorrect codes. Try again later or sign in with a new session.", 429, { lockedUntil: authSession.mfaLockedUntil.toISOString() });

  const rawCode = parsed.data.code;
  const isTotp = /^\d{6}$/.test(rawCode);
  const step = isTotp ? verifyTotp(decryptMfaSecret(method), rawCode) : null;
  const recoveryHash = !isTotp && normalizeRecoveryCode(rawCode).length === 16 ? hashRecoveryCode(rawCode) : null;
  const recoveryCode = recoveryHash ? await prisma.mfaRecoveryCode.findFirst({ where: { mfaMethodId: method.id, codeHash: recoveryHash, usedAt: null }, select: { id: true } }) : null;
  let accepted = false;
  const verifiedAt = new Date();

  if (step !== null) {
    const updated = await prisma.mfaMethod.updateMany({ where: { id: method.id, OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: step } }] }, data: { lastUsedStep: step } });
    accepted = updated.count === 1;
  } else if (recoveryCode) {
    const updated = await prisma.mfaRecoveryCode.updateMany({ where: { id: recoveryCode.id, usedAt: null }, data: { usedAt: verifiedAt } });
    accepted = updated.count === 1;
  }

  if (!accepted) {
    const failedSession = await prisma.authSession.update({ where: { id: session.sessionId }, data: { mfaFailedAttempts: { increment: 1 } }, select: { mfaFailedAttempts: true } });
    const attempts = failedSession.mfaFailedAttempts;
    const lockedUntil = attempts >= MAX_ATTEMPTS ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000) : null;
    await prisma.$transaction([
      ...(lockedUntil ? [prisma.authSession.update({ where: { id: session.sessionId }, data: { mfaLockedUntil: lockedUntil } })] : []),
      prisma.auditLog.create({ data: { actorId: session.userId, action: "security.mfa_challenge_failed", entityType: "AuthSession", entityId: session.sessionId, metadata: { attempts, lockedUntil: lockedUntil?.toISOString() ?? null } } }),
    ]);
    return apiError(lockedUntil ? "MFA_TEMPORARILY_LOCKED" : "INVALID_MFA_CODE", lockedUntil ? "Too many incorrect codes. This session is temporarily locked." : "That authenticator or recovery code is incorrect.", lockedUntil ? 429 : 401, lockedUntil ? { lockedUntil: lockedUntil.toISOString() } : undefined);
  }

  await prisma.$transaction([
    prisma.authSession.update({ where: { id: session.sessionId }, data: { mfaVerifiedAt: verifiedAt, mfaFailedAttempts: 0, mfaLockedUntil: null } }),
    prisma.auditLog.create({ data: { actorId: session.userId, action: recoveryCode ? "security.mfa_recovery_code_used" : "security.mfa_challenge_succeeded", entityType: "AuthSession", entityId: session.sessionId, metadata: { methodId: method.id } } }),
  ]);
  return apiSuccess({ verifiedAt: verifiedAt.toISOString(), recoveryCodeUsed: Boolean(recoveryCode) }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
