import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { sellerCatalogConnectionRevokeSchema, sellerCatalogConnectionView } from "@/modules/catalog/seller-catalog-connection";

export async function POST(request: NextRequest, context: { params: Promise<{ connectionId: string }> }) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.SELLER) || session.portal !== "seller") return apiError("SELLER_ACCESS_REQUIRED", "Seller access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "Revocation must originate from the protected Seller application.", 403);
  const parsed = sellerCatalogConnectionRevokeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Confirm revocation using the current request version.", 422);
  const { connectionId } = await context.params;
  const seller = await prisma.sellerProfile.findUnique({ where: { userId: session.userId }, select: { id: true } });
  if (!seller) return apiError("SELLER_NOT_FOUND", "Seller profile not found.", 404);
  const existing = await prisma.sellerCatalogConnection.findFirst({ where: { id: connectionId, sellerProfileId: seller.id } });
  if (!existing) return apiError("CATALOG_CONNECTION_NOT_FOUND", "Catalog connection was not found.", 404);
  if (existing.status === "REVOKED") return apiSuccess({ connection: sellerCatalogConnectionView(existing), alreadyRevoked: true, activationLocked: true }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  if (existing.version !== parsed.data.version) return apiError("CATALOG_CONNECTION_CHANGED", "This request changed. Refresh before revoking access.", 409);
  const now = new Date();
  const connection = await prisma.$transaction(async (tx) => {
    const changed = await tx.sellerCatalogConnection.updateMany({
      where: { id: connectionId, sellerProfileId: seller.id, status: { not: "REVOKED" }, version: parsed.data.version },
      data: { status: "REVOKED", consentRevokedAt: now, adapterKey: null, secretReference: null, dataUseApproved: false, mediaRightsApproved: false, securityApproved: false, reviewedById: null, reviewedAt: null, version: { increment: 1 } },
    });
    if (changed.count !== 1) throw new Error("CONNECTION_CHANGED");
    const revoked = await tx.sellerCatalogConnection.findUniqueOrThrow({ where: { id: connectionId } });
    await tx.auditLog.create({ data: { actorId: session.userId, action: "seller.catalog_connection_revoked", entityType: "SellerCatalogConnection", entityId: connectionId, metadata: { previousStatus: existing.status, consentVersion: existing.consentVersion, version: revoked.version } } });
    return revoked;
  }).catch((error) => {
    if (error instanceof Error && error.message === "CONNECTION_CHANGED") return null;
    throw error;
  });
  if (!connection) return apiError("CATALOG_CONNECTION_CHANGED", "This request changed. Refresh before revoking access.", 409);
  return apiSuccess({ connection: sellerCatalogConnectionView(connection), activationLocked: true }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
