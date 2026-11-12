import "server-only";
import type { PrismaClient } from "@prisma/client";
import { lockActiveAccount } from "@/modules/auth/account-mutation";

type ReviewInput = { userId: string; sessionId: string; verificationId: string; decision: "VERIFIED" | "REJECTED"; note: string; version: number };

/** Session identity comes from verified authentication; never accept it from request JSON. */
export async function reviewIdentityVerification(db: PrismaClient, input: ReviewInput) {
  return db.$transaction(async tx => {
    const initial = await tx.identityVerification.findUnique({ where: { id: input.verificationId }, select: { userId: true } });
    // Account first matches customer resubmission; sort multiple accounts to avoid
    // opposing reviewer/customer requests taking them in opposite orders.
    if (initial) await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" IN (${input.userId}, ${initial.userId}) ORDER BY "id" FOR NO KEY UPDATE`;
    const active = await lockActiveAccount(tx, input.userId, input.sessionId);
    const session = await tx.authSession.findUnique({ where: { id: input.sessionId }, select: { portal: true, mfaVerifiedAt: true, expiresAt: true } });
    await tx.$queryRaw`SELECT "roleId" FROM "UserRole" WHERE "userId" = ${input.userId} FOR SHARE`;
    const grant = await tx.userRole.findFirst({ where: { userId: input.userId, role: { code: "compliance" } }, select: { roleId: true } });
    if (!active || !session || session.portal !== "compliance" || !session.mfaVerifiedAt || session.expiresAt <= new Date() || !grant) {
      const actor = await tx.user.findUnique({ where: { id: input.userId }, select: { id: true } });
      await tx.auditLog.create({ data: { actorId: actor?.id ?? null, action: "identity_verification.review_denied", entityType: "IdentityVerification", metadata: { reason: "ACCESS_CHANGED" } } });
      return { outcome: "denied" } as const;
    }
    if (!initial) return { outcome: "conflict" } as const;
    const updated = await tx.identityVerification.updateMany({ where: { id: input.verificationId, userId: initial.userId, status: "PENDING", version: input.version }, data: { status: input.decision, reviewNote: input.note, reviewedAt: new Date(), reviewedById: input.userId, version: { increment: 1 } } });
    if (updated.count !== 1) return { outcome: "conflict" } as const;
    const verification = await tx.identityVerification.findUniqueOrThrow({ where: { id: input.verificationId }, select: { id: true, userId: true, documentType: true, status: true } });
    await tx.user.update({ where: { id: verification.userId }, data: { kycStatus: verification.status } });
    await tx.auditLog.create({ data: { actorId: input.userId, action: `identity_verification.${input.decision.toLowerCase()}`, entityType: "IdentityVerification", entityId: verification.id, metadata: { customerId: verification.userId, documentType: verification.documentType } } });
    return { outcome: "reviewed", verification } as const;
  });
}
