import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { parsePrivatePhotoReference } from "./photos";

const inputSchema = z.object({ sessionId: z.uuid(), uploadId: z.uuid(), kind: z.enum(["identity","inspection"]), subjectId: z.uuid() }).strict();
export class PrivatePhotoBindingError extends Error {
  constructor(code: "PRIVATE_PHOTO_BINDING_DENIED" | "PRIVATE_PHOTO_BINDING_CONFLICT" | "PRIVATE_PHOTO_BINDING_UNAVAILABLE") { super(code); }
}
const deny = () => new PrivatePhotoBindingError("PRIVATE_PHOTO_BINDING_DENIED");
type Tx = Prisma.TransactionClient;
async function authorizedSession(tx: Tx, sessionId: string) {
  const initial = await tx.authSession.findUnique({ where: { id: sessionId }, select: { userId: true } });
  if (!initial) throw deny();
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${initial.userId} FOR NO KEY UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "AuthSession" WHERE "id" = ${sessionId} FOR SHARE`;
  const session = await tx.authSession.findUnique({ where: { id: sessionId }, include: { user: { include: { roles: { include: { role: true } } } } } });
  if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.status !== "ACTIVE") throw deny();
  return { userId: session.userId, portal: session.portal, roles: session.user.roles.map(item => item.role.code), mfaVerifiedAt: session.mfaVerifiedAt };
}

/** Internal staged migration/linking component; session IDs come from verified server sessions. */
export function createPrivatePhotoLinks(db: PrismaClient, storageNamespace: string) {
  if (!/^[a-f0-9]{64}$/.test(storageNamespace)) throw new PrivatePhotoBindingError("PRIVATE_PHOTO_BINDING_UNAVAILABLE");
  async function link(raw: z.infer<typeof inputSchema>) {
    try {
      const input = inputSchema.parse(raw);
      return await db.$transaction(async tx => {
        const session = await authorizedSession(tx,input.sessionId);
        await tx.$queryRaw`SELECT "id" FROM "PrivatePhotoUpload" WHERE "id" = ${input.uploadId} FOR UPDATE`;
        const upload = await tx.privatePhotoUpload.findUnique({ where: { id: input.uploadId } });
        if (!upload || upload.actorId !== session.userId || upload.purpose !== input.kind || upload.status !== "STORED" || upload.storageNamespace !== storageNamespace) throw deny();
        const reference = parsePrivatePhotoReference(upload.storedReference);
        if (reference.purpose !== input.kind || upload.scanVerifiedSha256 !== reference.plaintextSha256 || !upload.scanVerifiedAt || upload.scanVerifiedAt < upload.createdAt || upload.scanVerifiedAt.getTime() > Date.now()+300_000) throw deny();
        if (input.kind === "identity") {
          if (session.portal !== "customer" || !session.roles.includes("customer_personal")) throw deny();
          await tx.$queryRaw`SELECT "id" FROM "IdentityVerification" WHERE "id" = ${input.subjectId} FOR UPDATE`;
          const subject = await tx.identityVerification.findUnique({ where: { id: input.subjectId }, select: { userId: true, documentPhotoSha256: true, documentPhotoMimeType: true, documentPhotoSizeBytes: true } });
          if (!subject || subject.userId !== session.userId || subject.documentPhotoSha256 !== reference.plaintextSha256 || subject.documentPhotoMimeType !== reference.mimeType || subject.documentPhotoSizeBytes !== reference.sizeBytes) throw deny();
        } else {
          const admin = session.portal === "admin" && session.roles.includes("admin") && Boolean(session.mfaVerifiedAt);
          const staff = session.portal === "warehouse" && session.roles.includes("warehouse_worker") || session.portal === "inspector" && session.roles.includes("inspector");
          if (!admin && !staff) throw deny();
          const subject = await tx.inspectionEvidence.findUnique({ where: { id: input.subjectId }, include: { package: { select: { warehouseId: true } } } });
          if (!subject || subject.uploadedById !== session.userId || subject.mediaKind !== "PHOTO" || subject.sha256 !== reference.plaintextSha256 || subject.mimeType !== reference.mimeType || subject.sizeBytes !== reference.sizeBytes) throw deny();
          if (!admin && (!subject.package.warehouseId || !await tx.warehouseStaffAssignment.findFirst({ where: { userId: session.userId, warehouseId: subject.package.warehouseId, isActive: true }, select: { id: true } }))) throw deny();
        }
        const target = input.kind === "identity" ? { identityVerificationId: input.subjectId } : { inspectionEvidenceId: input.subjectId };
        const existing = await tx.privatePhotoLink.findFirst({ where: { OR: [{ uploadId: input.uploadId },target] } });
        if (existing) {
          if (existing.uploadId !== input.uploadId || existing.linkedById !== session.userId || (input.kind === "identity" ? existing.identityVerificationId : existing.inspectionEvidenceId) !== input.subjectId) throw new PrivatePhotoBindingError("PRIVATE_PHOTO_BINDING_CONFLICT");
          return { id: existing.id, kind: input.kind, subjectId: input.subjectId, createdAt: existing.createdAt };
        }
        const created = await tx.privatePhotoLink.create({ data: { uploadId: input.uploadId, linkedById: session.userId, ...target } });
        await tx.auditLog.create({ data: { actorId: session.userId, action: "private_photo.linked", entityType: "PrivatePhotoLink", entityId: created.id, metadata: { kind: input.kind, subjectId: input.subjectId } } });
        return { id: created.id, kind: input.kind, subjectId: input.subjectId, createdAt: created.createdAt };
      });
    } catch (error) {
      if (error instanceof PrivatePhotoBindingError) throw error;
      throw new PrivatePhotoBindingError("PRIVATE_PHOTO_BINDING_UNAVAILABLE");
    }
  }
  return { link };
}
