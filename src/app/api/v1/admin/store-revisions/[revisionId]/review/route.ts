import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { sellerStoreProfileSchema } from "@/modules/sellers/store-profile-input";

const schema = z.object({ decision: z.enum(["APPROVED", "REJECTED"]), reviewNote: z.string().trim().min(3).max(500), version: z.number().int().positive() });

export async function PATCH(request: NextRequest, context: { params: Promise<{ revisionId: string }> }) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") {
    if (session?.userId) await prisma.auditLog.create({ data: { actorId: session.userId, action: "admin.store_revision_access_denied", entityType: "SellerStoreRevision", metadata: { portal: session.portal } } });
    return apiError("ADMIN_ACCESS_REQUIRED", "Admin access is required.", 403);
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "A valid decision, note, and revision version are required.", 422);
  const { revisionId } = await context.params;
  const revision = await prisma.sellerStoreRevision.findUnique({ where: { id: revisionId }, include: { sellerProfile: { select: { id: true, status: true, version: true } } } });
  if (!revision || revision.status !== "PENDING_REVIEW") return apiError("STORE_REVISION_NOT_REVIEWABLE", "These store changes are no longer awaiting review.", 409);
  if (revision.version !== parsed.data.version) return apiError("STORE_REVISION_VERSION_CONFLICT", "These store changes were reviewed in another session. Refresh and try again.", 409);
  if (revision.sellerProfile.status !== "APPROVED") return apiError("SELLER_NOT_APPROVED", "The seller must remain approved before public store changes can be published.", 409);

  const proposed = sellerStoreProfileSchema.safeParse({ businessName: revision.businessName, storeDescription: revision.storeDescription, processingDays: revision.processingDays });
  if (!proposed.success) return apiError("STORE_REVISION_INVALID", "The stored changes no longer satisfy public store rules.", 409);

  try {
    const reviewed = await prisma.$transaction(async (tx) => {
      const claimed = await tx.sellerStoreRevision.updateMany({ where: { id: revision.id, status: "PENDING_REVIEW", version: revision.version }, data: { status: parsed.data.decision, reviewNote: parsed.data.reviewNote, reviewerId: session.userId, reviewedAt: new Date(), version: { increment: 1 } } });
      if (claimed.count !== 1) throw new Error("REVISION_CONFLICT");
      if (parsed.data.decision === "APPROVED") {
        const changed = await tx.sellerProfile.updateMany({ where: { id: revision.sellerProfileId, status: "APPROVED", version: revision.baseSellerVersion }, data: { businessName: proposed.data.businessName, storeDescription: proposed.data.storeDescription, processingDays: proposed.data.processingDays, version: { increment: 1 } } });
        if (changed.count !== 1) throw new Error("STORE_CONFLICT");
      }
      await tx.auditLog.create({ data: { actorId: session.userId, action: `seller.store_revision_${parsed.data.decision.toLowerCase()}`, entityType: "SellerStoreRevision", entityId: revision.id, metadata: { sellerProfileId: revision.sellerProfileId, reviewNote: parsed.data.reviewNote, baseSellerVersion: revision.baseSellerVersion, published: parsed.data.decision === "APPROVED" } } });
      return tx.sellerStoreRevision.findUniqueOrThrow({ where: { id: revision.id }, select: { id: true, sellerProfileId: true, status: true, reviewNote: true, version: true } });
    });
    return apiSuccess({ revision: reviewed }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    if (error instanceof Error && (error.message === "REVISION_CONFLICT" || error.message === "STORE_CONFLICT")) return apiError("STORE_REVISION_VERSION_CONFLICT", "The store or revision changed in another session. Refresh and try again.", 409);
    throw error;
  }
}
