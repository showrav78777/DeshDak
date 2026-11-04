import { Prisma } from "@prisma/client";
import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { SELLER_CATALOG_CONSENT_VERSION, sellerCatalogConnectionResubmitSchema, sellerCatalogConnectionView, sellerCatalogSystemKey } from "@/modules/catalog/seller-catalog-connection";

export async function PATCH(request: NextRequest, context: { params: Promise<{ connectionId: string }> }) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.SELLER) || session.portal !== "seller") return apiError("SELLER_ACCESS_REQUIRED", "Seller access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "This connection update must originate from the protected Seller application.", 403);
  const parsed = sellerCatalogConnectionResubmitSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Check the catalog connection details.", 422);
  const { connectionId } = await context.params;
  const seller = await prisma.sellerProfile.findUnique({ where: { userId: session.userId }, select: { id: true, status: true } });
  if (!seller) return apiError("SELLER_NOT_FOUND", "Seller profile not found.", 404);
  if (seller.status !== "APPROVED") return apiError("SELLER_NOT_APPROVED", "Your seller account must remain approved.", 403);
  const existing = await prisma.sellerCatalogConnection.findFirst({ where: { id: connectionId, sellerProfileId: seller.id }, select: { id: true, status: true, version: true } });
  if (!existing) return apiError("CATALOG_CONNECTION_NOT_FOUND", "Catalog connection was not found.", 404);
  if (existing.status !== "CHANGES_REQUESTED") return apiError("CATALOG_CONNECTION_NOT_EDITABLE", "Only a request returned for changes can be resubmitted.", 409);
  if (existing.version !== parsed.data.version) return apiError("CATALOG_CONNECTION_CHANGED", "This request changed. Refresh before resubmitting.", 409);
  const systemKey = sellerCatalogSystemKey(parsed.data.systemName);
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.sellerCatalogConnection.updateMany({
      where: { id: connectionId, sellerProfileId: seller.id, status: "CHANGES_REQUESTED", version: parsed.data.version },
      data: {
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
        reviewNote: null,
        reviewedAt: null,
        reviewedById: null,
        status: "PENDING_REVIEW",
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw new Error("CONNECTION_CHANGED");
    const saved = await tx.sellerCatalogConnection.findUniqueOrThrow({ where: { id: connectionId } });
    await tx.auditLog.create({ data: { actorId: session.userId, action: "seller.catalog_connection_resubmitted", entityType: "SellerCatalogConnection", entityId: connectionId, metadata: { systemKey, version: saved.version, consentVersion: saved.consentVersion } } });
    return saved;
  }).then((connection) => ({ connection, error: null as null | "CHANGED" | "DUPLICATE" })).catch((error) => {
    if (error instanceof Error && error.message === "CONNECTION_CHANGED") return { connection: null, error: "CHANGED" as const };
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { connection: null, error: "DUPLICATE" as const };
    throw error;
  });
  if (result.error === "DUPLICATE") return apiError("CATALOG_CONNECTION_EXISTS", "A connection request for this system already exists.", 409);
  if (!result.connection) return apiError("CATALOG_CONNECTION_CHANGED", "This request changed. Refresh before resubmitting.", 409);
  return apiSuccess({ connection: sellerCatalogConnectionView(result.connection), activationLocked: true }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
