import { Prisma } from "@prisma/client";
import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { SELLER_CATALOG_CONSENT_VERSION, sellerCatalogConnectionRequestSchema, sellerCatalogConnectionView, sellerCatalogSystemKey } from "@/modules/catalog/seller-catalog-connection";

async function sellerFor(userId: string) {
  return prisma.sellerProfile.findUnique({ where: { userId }, select: { id: true, status: true } });
}

export async function GET(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.SELLER) || session.portal !== "seller") return apiError("SELLER_ACCESS_REQUIRED", "Seller access is required.", 403);
  const seller = await sellerFor(session.userId);
  if (!seller) return apiError("SELLER_NOT_FOUND", "Seller profile not found.", 404);
  const connections = await prisma.sellerCatalogConnection.findMany({ where: { sellerProfileId: seller.id }, orderBy: { createdAt: "desc" } });
  return apiSuccess({ connections: connections.map((connection) => sellerCatalogConnectionView(connection)), activationLocked: true }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function POST(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.SELLER) || session.portal !== "seller") return apiError("SELLER_ACCESS_REQUIRED", "Seller access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "This connection request must originate from the protected Seller application.", 403);
  const seller = await sellerFor(session.userId);
  if (!seller) return apiError("SELLER_NOT_FOUND", "Seller profile not found.", 404);
  if (seller.status !== "APPROVED") return apiError("SELLER_NOT_APPROVED", "Your seller account must be approved before requesting a catalog connection.", 403);
  const parsed = sellerCatalogConnectionRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Check the catalog connection details.", 422);
  const systemKey = sellerCatalogSystemKey(parsed.data.systemName);
  const duplicate = await prisma.sellerCatalogConnection.findUnique({ where: { sellerProfileId_systemKey: { sellerProfileId: seller.id, systemKey } }, select: { id: true } });
  if (duplicate) return apiError("CATALOG_CONNECTION_EXISTS", "A connection request for this system already exists.", 409);
  try {
    const connection = await prisma.$transaction(async (tx) => {
      const created = await tx.sellerCatalogConnection.create({
        data: {
          sellerProfileId: seller.id,
          systemName: parsed.data.systemName,
          systemKey,
          apiBaseUrl: parsed.data.apiBaseUrl,
          apiDocumentationUrl: parsed.data.apiDocumentationUrl,
          authMethod: parsed.data.authMethod,
          requestedCapabilities: parsed.data.requestedCapabilities,
          expectedProductCount: parsed.data.expectedProductCount,
          requestedSyncFrequencyMinutes: parsed.data.requestedSyncFrequencyMinutes,
          sellerNote: parsed.data.sellerNote,
          consentVersion: SELLER_CATALOG_CONSENT_VERSION,
          consentGrantedAt: new Date(),
        },
      });
      await tx.auditLog.create({ data: { actorId: session.userId, action: "seller.catalog_connection_requested", entityType: "SellerCatalogConnection", entityId: created.id, metadata: { systemKey, authMethod: created.authMethod, requestedCapabilities: created.requestedCapabilities, consentVersion: created.consentVersion } } });
      return created;
    });
    return apiSuccess({ connection: sellerCatalogConnectionView(connection), activationLocked: true }, { status: 201, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return apiError("CATALOG_CONNECTION_EXISTS", "A connection request for this system already exists.", 409);
    throw error;
  }
}
