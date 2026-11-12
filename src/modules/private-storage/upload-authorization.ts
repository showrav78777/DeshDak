import "server-only";
import type { Prisma } from "@prisma/client";
import { lockActiveAccount } from "@/modules/auth/account-mutation";
import { ROLE } from "@/lib/roles";

/** Fresh commit-time authorization after file processing; no network I/O under locks. */
export async function authorizePrivateUpload(tx: Prisma.TransactionClient, input: { userId: string; sessionId: string; kind: "identity" | "inspection"; packageId?: string }) {
  async function deny() {
    const actor = await tx.user.findUnique({ where: { id: input.userId }, select: { id: true } });
    await tx.auditLog.create({ data: { actorId: actor?.id ?? null, action: "private_upload.commit_denied", entityType: "PrivateUpload", metadata: { kind: input.kind, reason: "ACCESS_CHANGED" } } });
    return null;
  }
  if (!await lockActiveAccount(tx, input.userId, input.sessionId)) return deny();
  let parcel: { id: string; warehouseId: string | null; packageCode: string; status: string; isOutboundActive: boolean } | null = null;
  if (input.kind === "inspection") {
    if (!input.packageId) return deny();
    await tx.$queryRaw`SELECT "id" FROM "Package" WHERE "id" = ${input.packageId} FOR UPDATE`;
    parcel = await tx.package.findUnique({ where: { id: input.packageId }, select: { id: true, warehouseId: true, packageCode: true, status: true, isOutboundActive: true } });
    if (!parcel || !parcel.isOutboundActive || parcel.status === "EXPECTED") return deny();
  }
  const session = await tx.authSession.findUnique({ where: { id: input.sessionId }, select: { portal: true, mfaVerifiedAt: true, expiresAt: true } });
  if (!session || session.expiresAt <= new Date()) return deny();
  let assigned = false;
  if (input.kind === "inspection" && session.portal !== "admin" && parcel?.warehouseId) {
    const assignments = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "WarehouseStaffAssignment" WHERE "userId" = ${input.userId} AND "warehouseId" = ${parcel.warehouseId} AND "isActive" = true FOR SHARE`;
    assigned = assignments.length > 0;
  }
  // Read grants and evaluate expiry after all potentially blocking locks.
  await tx.$queryRaw`SELECT "roleId" FROM "UserRole" WHERE "userId" = ${input.userId} FOR SHARE`;
  const roles = (await tx.userRole.findMany({ where: { userId: input.userId }, select: { role: { select: { code: true } } } })).map(item => item.role.code);
  if (session.expiresAt <= new Date()) return deny();
  if (input.kind === "identity") return session.portal === "customer" && roles.includes(ROLE.CUSTOMER_PERSONAL) ? { packageCode: null } : deny();
  if (session.portal === "admin" && session.mfaVerifiedAt && roles.includes(ROLE.ADMIN)) return { packageCode: parcel!.packageCode };
  const staff = session.portal === "warehouse" && roles.includes(ROLE.WAREHOUSE_WORKER) || session.portal === "inspector" && roles.includes(ROLE.INSPECTOR);
  return staff && assigned ? { packageCode: parcel!.packageCode } : deny();
}
