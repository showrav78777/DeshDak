import "server-only";
import type { Prisma } from "@prisma/client";
import { lockActiveAccount } from "@/modules/auth/account-mutation";

/** Recheck under locks and the database clock; no browser-provided role grants. */
export async function authorizeVideoStaging(tx: Prisma.TransactionClient, input: { actorId: string; sessionId: string; packageId: string }) {
  if (!await lockActiveAccount(tx, input.actorId, input.sessionId)) return false;
  await tx.$queryRaw`SELECT "id" FROM "Package" WHERE "id" = ${input.packageId} FOR UPDATE`;
  const parcel = await tx.package.findUnique({ where: { id: input.packageId }, select: { warehouseId: true, isOutboundActive: true, status: true } });
  if (!parcel?.isOutboundActive || parcel.status === "EXPECTED") return false;
  await tx.$queryRaw`SELECT "roleId" FROM "UserRole" WHERE "userId" = ${input.actorId} FOR SHARE`;
  const roles = (await tx.userRole.findMany({ where: { userId: input.actorId }, select: { role: { select: { code: true } } } })).map(row => row.role.code);
  const session = await tx.authSession.findUnique({ where: { id: input.sessionId }, select: { userId: true, portal: true, revokedAt: true, expiresAt: true, mfaVerifiedAt: true } });
  let assigned = false;
  if (parcel.warehouseId && session?.portal !== "admin") {
    assigned = (await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "WarehouseStaffAssignment" WHERE "userId" = ${input.actorId} AND "warehouseId" = ${parcel.warehouseId} AND "isActive" = true FOR SHARE`).length > 0;
  }
  const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp()::timestamp(3) AS "now"`;
  if (!session || session.userId !== input.actorId || session.revokedAt || !clock?.now || session.expiresAt <= clock.now || session.mfaVerifiedAt && session.mfaVerifiedAt > clock.now) return false;
  if (session.portal === "admin" && roles.includes("admin")) return Boolean(session.mfaVerifiedAt && clock.now.getTime() - session.mfaVerifiedAt.getTime() <= 15 * 60_000);
  return assigned && (session.portal === "inspector" && roles.includes("inspector") || session.portal === "warehouse" && roles.includes("warehouse_worker"));
}
