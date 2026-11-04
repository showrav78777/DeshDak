import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { createTransactionalNotification } from "@/modules/notifications/service";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { adminSellerCatalogConnectionSchema, sellerCatalogConnectionView } from "@/modules/catalog/seller-catalog-connection";

export async function PATCH(request: NextRequest, context: { params: Promise<{ connectionId: string }> }) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") return apiError("ADMIN_ACCESS_REQUIRED", "Admin access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "This review must originate from the protected Admin application.", 403);
  const parsed = adminSellerCatalogConnectionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Check the connection review.", 422);
  const { connectionId } = await context.params;
  const existing = await prisma.sellerCatalogConnection.findUnique({ where: { id: connectionId }, include: { sellerProfile: { select: { userId: true, status: true, businessName: true } } } });
  if (!existing) return apiError("CATALOG_CONNECTION_NOT_FOUND", "Catalog connection was not found.", 404);
  if (existing.status === "REVOKED") return apiError("CATALOG_CONNECTION_REVOKED", "The seller revoked this connection. It cannot be reviewed or configured.", 409);
  if (existing.status !== "PENDING_REVIEW") return apiError("CATALOG_CONNECTION_NOT_REVIEWABLE", "Only a pending request can be reviewed.", 409);
  if (existing.sellerProfile.status !== "APPROVED") return apiError("SELLER_NOT_APPROVED", "The seller must remain approved before connection configuration is saved.", 409);
  if (existing.version !== parsed.data.version) return apiError("CATALOG_CONNECTION_CHANGED", "This request changed. Refresh before reviewing it.", 409);

  const status = parsed.data.decision === "REQUEST_CHANGES" ? "CHANGES_REQUESTED" : parsed.data.decision === "REJECT" ? "REJECTED" : "CONFIGURATION_SAVED";
  const connection = await prisma.$transaction(async (tx) => {
    const changed = await tx.sellerCatalogConnection.updateMany({
      where: { id: connectionId, status: "PENDING_REVIEW", version: parsed.data.version },
      data: {
        status,
        reviewNote: parsed.data.reviewNote,
        reviewedById: session.userId,
        reviewedAt: new Date(),
        version: { increment: 1 },
        ...(parsed.data.decision === "SAVE_CONFIGURATION" ? {
          adapterKey: parsed.data.adapterKey,
          secretReference: parsed.data.secretReference,
          dataUseApproved: true,
          mediaRightsApproved: true,
          securityApproved: true,
        } : {
          adapterKey: null,
          secretReference: null,
          dataUseApproved: false,
          mediaRightsApproved: false,
          securityApproved: false,
        }),
      },
    });
    if (changed.count !== 1) throw new Error("CONNECTION_CHANGED");
    const saved = await tx.sellerCatalogConnection.findUniqueOrThrow({ where: { id: connectionId } });
    await tx.auditLog.create({
      data: {
        actorId: session.userId,
        action: `seller.catalog_connection_${status.toLowerCase()}`,
        entityType: "SellerCatalogConnection",
        entityId: connectionId,
        metadata: { decision: parsed.data.decision, previousStatus: existing.status, status, adapterKey: saved.adapterKey, secretReferenceConfigured: Boolean(saved.secretReference), approvals: { dataUse: saved.dataUseApproved, mediaRights: saved.mediaRightsApproved, security: saved.securityApproved }, activationLocked: true, version: saved.version },
      },
    });
    await createTransactionalNotification(tx, {
      userId: existing.sellerProfile.userId,
      eventType: `SELLER_CATALOG_CONNECTION_${status}`,
      title: status === "CHANGES_REQUESTED" ? "Catalog connection needs changes" : status === "REJECTED" ? "Catalog connection was not approved" : "Catalog connection configuration saved",
      body: status === "CONFIGURATION_SAVED" ? `${existing.systemName} passed configuration review, but synchronization remains disabled until DeshDak completes and verifies its adapter.` : parsed.data.reviewNote,
      deepLink: "/seller/integrations",
      entityType: "SellerCatalogConnection",
      entityId: connectionId,
      priority: status === "CHANGES_REQUESTED" ? "HIGH" : "NORMAL",
      channels: ["IN_APP", "EMAIL"],
      idempotencyKey: `seller-catalog-connection:${connectionId}:${status}:${saved.version}`,
    });
    return saved;
  }).catch((error) => {
    if (error instanceof Error && error.message === "CONNECTION_CHANGED") return null;
    throw error;
  });
  if (!connection) return apiError("CATALOG_CONNECTION_CHANGED", "This request changed. Refresh before reviewing it.", 409);
  return apiSuccess({ connection: sellerCatalogConnectionView(connection, true), activationLocked: true }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
