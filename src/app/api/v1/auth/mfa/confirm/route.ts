import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { decryptMfaSecret, generateRecoveryCodes, hashRecoveryCode, verifyTotp } from "@/lib/mfa";
import { getPendingPrivilegedSession, hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";

const schema = z.object({ code: z.string().trim().regex(/^\d{6}$/) });

export async function POST(request: NextRequest) {
  if (!hasTrustedMutationOrigin(request)) return apiError("INVALID_ORIGIN", "The request origin could not be verified.", 403);
  const session = await getPendingPrivilegedSession(request);
  if (!session) return apiError("UNAUTHORIZED", "Sign in through an authorized privileged portal first.", 401);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Enter the 6-digit code from your authenticator app.", 422);
  const enrollment = await prisma.mfaEnrollment.findUnique({ where: { userId: session.userId } });
  if (!enrollment || enrollment.expiresAt <= new Date()) return apiError("MFA_ENROLLMENT_EXPIRED", "Authenticator setup expired. Start setup again.", 410);
  const step = verifyTotp(decryptMfaSecret(enrollment), parsed.data.code);
  if (step === null) return apiError("INVALID_MFA_CODE", "That authenticator code is incorrect or expired.", 401);
  const recoveryCodes = generateRecoveryCodes();
  const verifiedAt = new Date();
  try {
    await prisma.$transaction(async (tx) => {
      const method = await tx.mfaMethod.create({ data: { userId: session.userId, type: "TOTP", secretCiphertext: enrollment.secretCiphertext, secretIv: enrollment.secretIv, secretTag: enrollment.secretTag, lastUsedStep: step, recoveryCodes: { create: recoveryCodes.map((code) => ({ codeHash: hashRecoveryCode(code) })) } } });
      await tx.mfaEnrollment.delete({ where: { id: enrollment.id } });
      await tx.authSession.update({ where: { id: session.sessionId }, data: { mfaVerifiedAt: verifiedAt, mfaFailedAttempts: 0, mfaLockedUntil: null } });
      await tx.auditLog.create({ data: { actorId: session.userId, action: "security.mfa_enabled", entityType: "MfaMethod", entityId: method.id, metadata: { authSessionId: session.sessionId, recoveryCodeCount: recoveryCodes.length } } });
    });
  } catch {
    return apiError("MFA_ENROLLMENT_CONFLICT", "Authenticator verification is already enabled. Sign in again.", 409);
  }
  return apiSuccess({ verifiedAt: verifiedAt.toISOString(), recoveryCodes }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
