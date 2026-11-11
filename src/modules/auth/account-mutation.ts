import "server-only";
import type { Prisma } from "@prisma/client";

/** Serialize account changes with verification and logout; never trust a stale profile snapshot. */
export async function lockActiveAccount(tx: Prisma.TransactionClient, userId: string, sessionId: string) {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR NO KEY UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "AuthSession" WHERE "id" = ${sessionId} FOR SHARE`;
  const session = await tx.authSession.findUnique({ where: { id: sessionId }, select: {
    userId: true, revokedAt: true, expiresAt: true,
    user: { select: { id: true, status: true, deletedAt: true, phone: true, phoneVerifiedAt: true, residenceCountryCode: true } },
  } });
  if (!session || session.userId !== userId || session.revokedAt || session.expiresAt <= new Date() || session.user.status !== "ACTIVE" || session.user.deletedAt) return null;
  return session.user;
}
