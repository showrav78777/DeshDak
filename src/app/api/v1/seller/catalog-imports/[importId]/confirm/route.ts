import { Prisma } from "@prisma/client";
import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { sellerProductInputSchema } from "@/modules/catalog/seller-product-input";
import { createSellerProduct } from "@/modules/catalog/seller-product-creation";

const confirmationSchema = z.object({ version: z.coerce.number().int().positive(), confirmation: z.literal("IMPORT_VALIDATED_CATALOG") }).strict();

export async function POST(request: NextRequest, context: { params: Promise<{ importId: string }> }) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.SELLER) || session.portal !== "seller") return apiError("SELLER_ACCESS_REQUIRED", "Seller access is required.", 403);
  const parsed = confirmationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Explicit import confirmation and the current preview version are required.", 422);
  const { importId } = await context.params;
  const seller = await prisma.sellerProfile.findUnique({ where: { userId: session.userId }, select: { id: true, status: true, originCountryCode: true, shipsInternationally: true } });
  if (!seller) return apiError("SELLER_NOT_FOUND", "Seller profile not found.", 404);
  if (seller.status !== "APPROVED") return apiError("SELLER_NOT_APPROVED", "Your seller account must remain approved to confirm an import.", 403);
  const initial = await prisma.sellerCatalogImport.findFirst({ where: { id: importId, sellerProfileId: seller.id }, select: { id: true, status: true, invalidRows: true, expiresAt: true, version: true, totalRows: true } });
  if (!initial) return apiError("CATALOG_IMPORT_NOT_FOUND", "Catalog import was not found.", 404);
  if (initial.status === "COMPLETED") return apiSuccess({ catalogImport: { id: initial.id, status: initial.status, version: initial.version, totalRows: initial.totalRows }, alreadyCompleted: true });
  if (initial.status !== "PREVIEW_READY") return apiError("CATALOG_IMPORT_NOT_CONFIRMABLE", "This catalog preview can no longer be confirmed.", 409);
  if (initial.expiresAt <= new Date()) {
    await prisma.sellerCatalogImport.updateMany({ where: { id: importId, status: "PREVIEW_READY" }, data: { status: "EXPIRED", version: { increment: 1 } } });
    return apiError("CATALOG_IMPORT_EXPIRED", "This preview expired. Upload the CSV again for fresh validation.", 409);
  }
  if (initial.invalidRows > 0) return apiError("CATALOG_IMPORT_HAS_ERRORS", "Fix every invalid row and create a new preview before importing.", 409, { invalidRows: initial.invalidRows });
  if (initial.version !== parsed.data.version) return apiError("CATALOG_IMPORT_VERSION_CONFLICT", "This preview changed. Refresh before confirming.", 409);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const claimed = await tx.sellerCatalogImport.updateMany({ where: { id: importId, sellerProfileId: seller.id, status: "PREVIEW_READY", version: parsed.data.version, expiresAt: { gt: new Date() }, invalidRows: 0 }, data: { version: { increment: 1 } } });
      if (claimed.count !== 1) throw new Error("IMPORT_CONFLICT");
      const catalogImport = await tx.sellerCatalogImport.findUniqueOrThrow({ where: { id: importId }, include: { rows: { orderBy: { rowNumber: "asc" } } } });
      if (catalogImport.rows.length !== catalogImport.totalRows || catalogImport.rows.some((row) => row.status !== "VALID" || !row.normalizedData)) throw new Error("IMPORT_ROWS_CHANGED");
      const localSource = await tx.sourcePlatform.upsert({ where: { code: "LOCAL_SELLER" }, update: { supportedCountries: ["BD"], supportsOrders: true, isActive: true }, create: { code: "LOCAL_SELLER", displayName: "Bangladesh local sellers", supportedCountries: ["BD"], supportsOrders: true, isActive: true }, select: { id: true } });
      const products = [];
      for (const row of catalogImport.rows) {
        const productInput = sellerProductInputSchema.safeParse(row.normalizedData);
        if (!productInput.success) throw new Error("IMPORT_ROWS_CHANGED");
        const product = await createSellerProduct(tx, productInput.data, seller, session.userId, "CSV_IMPORT", { catalogImportId: importId, catalogImportRowId: row.id, sourcePlatformId: localSource.id });
        await tx.sellerCatalogImportRow.update({ where: { id: row.id }, data: { status: "IMPORTED", productId: product.id } });
        products.push({ id: product.id, productCode: product.productCode, titleEn: product.titleEn, status: product.status });
      }
      const completed = await tx.sellerCatalogImport.update({ where: { id: importId }, data: { status: "COMPLETED", confirmedAt: new Date() }, select: { id: true, status: true, version: true, totalRows: true, confirmedAt: true } });
      await tx.auditLog.create({ data: { actorId: session.userId, action: "seller.catalog_import_completed", entityType: "SellerCatalogImport", entityId: importId, metadata: { totalRows: completed.totalRows, productIds: products.map((product) => product.id), submissionMode: "CSV_IMPORT" } } });
      return { completed, products };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return apiSuccess({ catalogImport: { ...result.completed, confirmedAt: result.completed.confirmedAt?.toISOString() ?? null }, products: result.products, alreadyCompleted: false }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    if (error instanceof Error && error.message === "IMPORT_CONFLICT") return apiError("CATALOG_IMPORT_VERSION_CONFLICT", "This preview is already being processed or changed. Refresh before retrying.", 409);
    if (error instanceof Error && error.message === "IMPORT_ROWS_CHANGED") return apiError("CATALOG_IMPORT_INTEGRITY_ERROR", "Stored preview validation no longer matches. Create a new preview.", 409);
    if (error instanceof Error && error.message === "CATEGORY_NOT_AVAILABLE") return apiError("CATEGORY_NOT_AVAILABLE", "A mapped category became unavailable. Create a new preview.", 409);
    if (error instanceof Error && error.message === "SKU_ALREADY_USED") return apiError("SKU_ALREADY_USED", "A seller SKU was assigned after this preview. Create a new preview.", 409);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return apiError("CATALOG_IMPORT_CONFLICT", "The catalog conflicts with an existing SKU or was already imported.", 409);
    throw error;
  }
}
