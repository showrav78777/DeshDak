import "server-only";
import type { Prisma } from "@prisma/client";
import { lockActiveAccount } from "@/modules/auth/account-mutation";

/** Called inside the rule mutation transaction with verified server identity. */
export async function authorizeComplianceRuleAdmin(tx: Prisma.TransactionClient, userId: string, sessionId: string) {
  const active = await lockActiveAccount(tx, userId, sessionId);
  const session = await tx.authSession.findUnique({ where: { id: sessionId }, select: { portal: true, mfaVerifiedAt: true, expiresAt: true } });
  await tx.$queryRaw`SELECT "roleId" FROM "UserRole" WHERE "userId" = ${userId} FOR SHARE`;
  const grant = await tx.userRole.findFirst({ where: { userId, role: { code: "admin" } }, select: { roleId: true } });
  if (active && session?.portal === "admin" && session.mfaVerifiedAt && session.expiresAt > new Date() && grant) return true;
  const actor = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
  await tx.auditLog.create({ data: { actorId: actor?.id ?? null, action: "compliance.rule_change_denied", entityType: "RestrictedGoodsRule", metadata: { reason: "ACCESS_CHANGED" } } });
  return false;
}
