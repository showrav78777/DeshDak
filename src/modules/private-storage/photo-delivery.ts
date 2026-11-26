import "server-only";
import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { parsePrivatePhotoReference, type createPrivatePhotoStore } from "./photos";

const requestSchema = z.object({
  sessionId: z.uuid(),
  kind: z.enum(["identity", "inspection"]),
  subjectId: z.uuid(),
}).strict();
type ReadRequest = z.infer<typeof requestSchema>;
type Tx = Prisma.TransactionClient;

export class PrivatePhotoDeliveryError extends Error {
  constructor(code: "PRIVATE_PHOTO_ACCESS_DENIED" | "PRIVATE_PHOTO_UNAVAILABLE") { super(code); }
}
const denied = () => new PrivatePhotoDeliveryError("PRIVATE_PHOTO_ACCESS_DENIED");

/** Internal only. sessionId must come from a verified server session, never request JSON. */
export function createPrivatePhotoDelivery(db: PrismaClient, store: Pick<ReturnType<typeof createPrivatePhotoStore>, "namespace" | "read">) {
  if (!/^[a-f0-9]{64}$/.test(store.namespace)) throw new PrivatePhotoDeliveryError("PRIVATE_PHOTO_UNAVAILABLE");

  async function authorize(tx: Tx, input: ReadRequest) {
    const initial = await tx.authSession.findUnique({ where: { id: input.sessionId }, select: { userId: true } });
    if (!initial) throw denied();
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${initial.userId} FOR NO KEY UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "AuthSession" WHERE "id" = ${input.sessionId} FOR SHARE`;
    const session = await tx.authSession.findUnique({ where: { id: input.sessionId }, include: { user: { include: { roles: { include: { role: true } } } } } });
    const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp()::timestamp(3) AS now`;
    if (!(clock?.now instanceof Date) || !Number.isFinite(clock.now.getTime()) || !session || session.revokedAt || session.expiresAt <= clock.now || session.user.status !== "ACTIVE" || session.user.deletedAt || session.mfaVerifiedAt && session.mfaVerifiedAt > clock.now) throw denied();
    const roles = session.user.roles.map(item => item.role.code);
    const target = input.kind === "identity" ? { identityVerificationId: input.subjectId } : { inspectionEvidenceId: input.subjectId };
    const initialLink = await tx.privatePhotoLink.findFirst({ where: target, select: { id: true, uploadId: true } });
    if (!initialLink) throw denied();
    // Match the upload/linking lock order; no transaction is held during S3 I/O.
    await tx.$queryRaw`SELECT "id" FROM "PrivatePhotoUpload" WHERE "id" = ${initialLink.uploadId} FOR SHARE`;
    await tx.$queryRaw`SELECT "id" FROM "PrivatePhotoLink" WHERE "id" = ${initialLink.id} FOR SHARE`;
    const link = await tx.privatePhotoLink.findFirst({ where: { ...target, id: initialLink.id }, include: { upload: { include: { quarantine: true } } } });
    if (!link) throw denied();
    const upload = link.upload;
    if (upload.quarantine || upload.status !== "STORED" || upload.purpose !== input.kind || upload.storageNamespace !== store.namespace || link.linkedById !== upload.actorId) throw denied();
    const reference = parsePrivatePhotoReference(upload.storedReference);
    if (reference.purpose !== input.kind || !upload.originalScanVerifiedAt || !/^[a-f0-9]{64}$/.test(upload.originalScanSha256 ?? "") || !upload.scanVerifiedAt || upload.originalScanVerifiedAt > upload.scanVerifiedAt || upload.scanVerifiedAt < upload.createdAt || upload.scanVerifiedAt.getTime() > clock.now.getTime() + 300_000 || upload.scanVerifiedSha256 !== reference.plaintextSha256) throw denied();
    if (input.kind === "identity") {
      if (session.portal !== "compliance" || !roles.includes("compliance") || !session.mfaVerifiedAt) throw denied();
      await tx.$queryRaw`SELECT "id" FROM "IdentityVerification" WHERE "id" = ${input.subjectId} FOR SHARE`;
      const subject = await tx.identityVerification.findUnique({ where: { id: input.subjectId } });
      if (!subject || subject.userId !== upload.actorId || subject.documentPhotoSha256 !== reference.plaintextSha256 || subject.documentPhotoMimeType !== reference.mimeType || subject.documentPhotoSizeBytes !== reference.sizeBytes) throw denied();
    } else {
      await tx.$queryRaw`SELECT "id" FROM "InspectionEvidence" WHERE "id" = ${input.subjectId} FOR SHARE`;
      const subject = await tx.inspectionEvidence.findUnique({ where: { id: input.subjectId }, include: { package: true } });
      if (!subject || subject.uploadedById !== upload.actorId || subject.mediaKind !== "PHOTO" || subject.sha256 !== reference.plaintextSha256 || subject.mimeType !== reference.mimeType || subject.sizeBytes !== reference.sizeBytes) throw denied();
      await tx.$queryRaw`SELECT "id" FROM "Package" WHERE "id" = ${subject.packageId} FOR SHARE`;
      // Reload the package after taking its lock; warehouse/order may have changed.
      const parcel = await tx.package.findUniqueOrThrow({ where: { id: subject.packageId } });
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${parcel.orderId} FOR SHARE`;
      const order = await tx.order.findUniqueOrThrow({ where: { id: parcel.orderId }, select: { customerId: true } });
      const customer = session.portal === "customer" && roles.includes("customer_personal") && order.customerId === session.userId;
      const admin = session.portal === "admin" && roles.includes("admin") && Boolean(session.mfaVerifiedAt);
      const staff = session.portal === "warehouse" && roles.includes("warehouse_worker") || session.portal === "inspector" && roles.includes("inspector");
      if (!customer && !admin) {
        if (!staff || !parcel.warehouseId) throw denied();
        const assignments = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "WarehouseStaffAssignment" WHERE "userId" = ${session.userId} AND "warehouseId" = ${parcel.warehouseId} AND "isActive" = true FOR SHARE`;
        if (!assignments.length) throw denied();
      }
    }
    const [finalClock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp()::timestamp(3) AS now`;
    if (!(finalClock?.now instanceof Date) || !Number.isFinite(finalClock.now.getTime()) || session.expiresAt <= finalClock.now || session.mfaVerifiedAt && session.mfaVerifiedAt > finalClock.now) throw denied();
    return { actorId: session.userId, linkId: link.id, reference };
  }

  return { read: async (raw: ReadRequest) => {
    let input: ReadRequest | undefined;
    let actorId: string | undefined;
    try {
      input = requestSchema.parse(raw);
      const before = await db.$transaction(tx => authorize(tx, input!));
      actorId = before.actorId;
      const bytes = await store.read(before.reference);
      if (bytes.length !== before.reference.sizeBytes || createHash("sha256").update(bytes).digest("hex") !== before.reference.plaintextSha256) throw new PrivatePhotoDeliveryError("PRIVATE_PHOTO_UNAVAILABLE");
      await db.$transaction(async tx => {
        const after = await authorize(tx, input!);
        if (after.actorId !== before.actorId || after.linkId !== before.linkId || JSON.stringify(after.reference) !== JSON.stringify(before.reference)) throw denied();
        await tx.auditLog.create({ data: { actorId, action: "private_photo.viewed", entityType: "PrivatePhotoLink", entityId: after.linkId, metadata: { kind: input!.kind } } });
      });
      return { bytes, mimeType: before.reference.mimeType };
    } catch (error) {
      // Audit failures block delivery too. Fixed metadata never includes object references or provider errors.
      try {
        const session = input ? await db.authSession.findUnique({ where: { id: input.sessionId }, select: { userId: true } }) : null;
        await db.auditLog.create({ data: { actorId: session?.userId ?? actorId, action: "private_photo.view_blocked", entityType: "PrivatePhotoDelivery", metadata: { kind: input?.kind ?? "invalid", outcome: error instanceof PrivatePhotoDeliveryError && error.message === "PRIVATE_PHOTO_ACCESS_DENIED" ? "denied" : "unavailable" } } });
      } catch { throw new PrivatePhotoDeliveryError("PRIVATE_PHOTO_UNAVAILABLE"); }
      if (error instanceof PrivatePhotoDeliveryError) throw error;
      throw new PrivatePhotoDeliveryError("PRIVATE_PHOTO_UNAVAILABLE");
    }
  } };
}
