import "server-only";
import type { PrismaClient } from "@prisma/client";
import { lockActiveAccount } from "@/modules/auth/account-mutation";

/** Final authorization for existing DB-backed files; does not activate production intake. */
export async function authorizeLegacyPhotoRead(db: PrismaClient, input: { userId: string; sessionId: string; kind: "identity" | "inspection"; subjectId: string; sha256: string | null }) {
  return db.$transaction(async tx => {
    async function deny() {
      const actor = await tx.user.findUnique({ where: { id: input.userId }, select: { id: true } });
      await tx.auditLog.create({ data: { actorId: actor?.id ?? null, action: "private_photo.legacy_view_blocked", entityType: "PrivatePhotoDelivery", metadata: { kind: input.kind, outcome: "access_changed" } } });
      return false;
    }
    if (!await lockActiveAccount(tx, input.userId, input.sessionId)) return deny();
    const session = await tx.authSession.findUnique({ where: { id: input.sessionId }, select: { portal: true, expiresAt: true, mfaVerifiedAt: true } });
    if (!session) return deny();
    let warehouseId: string | null = null, ownerId: string | null = null;
    if (input.kind === "identity") {
      await tx.$queryRaw`SELECT "id" FROM "IdentityVerification" WHERE "id" = ${input.subjectId} FOR SHARE`;
      const record = await tx.identityVerification.findUnique({ where: { id: input.subjectId }, select: { documentPhotoSha256: true } });
      if (!record || record.documentPhotoSha256 !== input.sha256) return deny();
    } else {
      await tx.$queryRaw`SELECT "id" FROM "InspectionEvidence" WHERE "id" = ${input.subjectId} FOR SHARE`;
      const record = await tx.inspectionEvidence.findUnique({ where: { id: input.subjectId }, select: { packageId: true, sha256: true } });
      if (!record || record.sha256 !== input.sha256) return deny();
      await tx.$queryRaw`SELECT "id" FROM "Package" WHERE "id" = ${record.packageId} FOR SHARE`;
      const parcel = await tx.package.findUniqueOrThrow({ where: { id: record.packageId }, select: { warehouseId: true, orderId: true } });
      warehouseId = parcel.warehouseId;
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${parcel.orderId} FOR SHARE`;
      ownerId = (await tx.order.findUniqueOrThrow({ where: { id: parcel.orderId }, select: { customerId: true } })).customerId;
    }
    let assigned = false;
    if (warehouseId && (session.portal === "warehouse" || session.portal === "inspector")) {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "WarehouseStaffAssignment" WHERE "userId" = ${input.userId} AND "warehouseId" = ${warehouseId} AND "isActive" = true FOR SHARE`;
      assigned = rows.length > 0;
    }
    await tx.$queryRaw`SELECT "roleId" FROM "UserRole" WHERE "userId" = ${input.userId} FOR SHARE`;
    const roles = (await tx.userRole.findMany({ where: { userId: input.userId }, select: { role: { select: { code: true } } } })).map(row => row.role.code);
    const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp()::timestamp(3) AS now`;
    if (!(clock?.now instanceof Date) || !Number.isFinite(clock.now.getTime()) || session.expiresAt <= clock.now || session.mfaVerifiedAt && session.mfaVerifiedAt > clock.now) return deny();
    const allowed = input.kind === "identity"
      ? session.portal === "compliance" && roles.includes("compliance") && Boolean(session.mfaVerifiedAt)
      : session.portal === "customer" && roles.includes("customer_personal") && ownerId === input.userId
        || session.portal === "admin" && roles.includes("admin") && Boolean(session.mfaVerifiedAt)
        || assigned && (session.portal === "warehouse" && roles.includes("warehouse_worker") || session.portal === "inspector" && roles.includes("inspector"));
    if (!allowed) return deny();
    // Preserve the legacy quarantine guard after any authorization lock wait.
    const quarantined = await tx.privatePhotoLink.findFirst({ where: { ...(input.kind === "identity" ? { identityVerificationId: input.subjectId } : { inspectionEvidenceId: input.subjectId }), upload: { quarantine: { isNot: null } } }, select: { id: true } });
    if (quarantined) return deny();
    await tx.auditLog.create({ data: { actorId: input.userId, action: input.kind === "identity" ? "identity_verification.document_viewed" : "inspection.evidence_viewed", entityType: input.kind === "identity" ? "IdentityVerification" : "InspectionEvidence", entityId: input.subjectId, metadata: { kind: input.kind } } });
    return true;
  });
}
