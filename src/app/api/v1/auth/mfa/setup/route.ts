import QRCode from "qrcode";
import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { decryptMfaSecret, encryptMfaSecret, generateTotpSecret, totpUri } from "@/lib/mfa";
import { getPendingPrivilegedSession, hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  if (!hasTrustedMutationOrigin(request)) return apiError("INVALID_ORIGIN", "The request origin could not be verified.", 403);
  const session = await getPendingPrivilegedSession(request);
  if (!session) return apiError("UNAUTHORIZED", "Sign in through an authorized privileged portal first.", 401);
  if (session.mfaVerifiedAt) return apiError("MFA_ALREADY_VERIFIED", "This administrator session is already verified.", 409);
  const existingMethod = await prisma.mfaMethod.findUnique({ where: { userId: session.userId }, select: { id: true } });
  if (existingMethod) return apiError("MFA_ALREADY_ENABLED", "Authenticator verification is already enabled. Enter your current code instead.", 409);

  const now = new Date();
  const encrypted = encryptMfaSecret(generateTotpSecret());
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);
  const enrollment = await prisma.$transaction(async (tx) => {
    // Repeated mounts/tabs must not invalidate a QR code already shown to this user.
    await tx.mfaEnrollment.upsert({ where: { userId: session.userId }, create: { userId: session.userId, ...encrypted, expiresAt }, update: {} });
    await tx.mfaEnrollment.updateMany({ where: { userId: session.userId, expiresAt: { lte: now } }, data: { ...encrypted, expiresAt, createdAt: now } });
    const current = await tx.mfaEnrollment.findUniqueOrThrow({ where: { userId: session.userId } });
    await tx.auditLog.create({ data: { actorId: session.userId, action: "security.mfa_enrollment_started", entityType: "User", entityId: session.userId, metadata: { authSessionId: session.sessionId, expiresAt: current.expiresAt.toISOString() } } });
    return current;
  });
  const secret = decryptMfaSecret(enrollment);
  const uri = totpUri(secret, session.email);
  const qrCodeDataUrl = await QRCode.toDataURL(uri, { errorCorrectionLevel: "M", margin: 1, width: 240 });
  return apiSuccess({ secret, uri, qrCodeDataUrl, expiresAt: enrollment.expiresAt.toISOString() }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
