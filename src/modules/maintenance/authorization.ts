import "server-only";
import type { Prisma } from "@prisma/client";
import { lockActiveAccount } from "@/modules/auth/account-mutation";

/** Called inside the security maintenance transaction with verified server identity. */
export async function authorizeSecurityMaintenance(tx: Prisma.TransactionClient, userId: string, sessionId: string, operation: "run" | "configuration") {
  const active = await lockActiveAccount(tx, userId, sessionId);
  const session = await tx.authSession.findUnique({ where: { id: sessionId }, select: { portal: true, mfaVerifiedAt: true, expiresAt: true } });
  await tx.$queryRaw`SELECT "roleId" FROM "UserRole" WHERE "userId" = ${userId} FOR SHARE`;
  const grant = await tx.userRole.findFirst({ where: { userId, role: { code: "admin" } }, select: { roleId: true } });
  if (active && session?.portal === "admin" && session.mfaVerifiedAt && session.expiresAt > new Date() && grant) return true;
  const actor = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
  await tx.auditLog.create({ data: { actorId: actor?.id ?? null, action: operation === "run" ? "maintenance.security_cleanup_denied" : "maintenance.security_cleanup_configuration_denied", entityType: operation === "run" ? "MaintenanceJobRun" : "MaintenanceConfiguration", metadata: { reason: "ACCESS_CHANGED", operation } } });
  return false;
}
