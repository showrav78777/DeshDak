import { Prisma } from "@prisma/client";
import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { buildCatalogImportRows, catalogImportPreviewSchema, createImportFingerprint, IMPORT_PREVIEW_MINUTES, validateImportMapping } from "@/modules/catalog/seller-catalog-import";

async function approvedSeller(userId: string) {
  return prisma.sellerProfile.findUnique({ where: { userId }, select: { id: true, status: true } });
}

function importView(item: { id: string; status: string; originalFilename: string | null; totalRows: number; validRows: number; invalidRows: number; version: number; expiresAt: Date; confirmedAt: Date | null; createdAt: Date; rows?: { rowNumber: number; status: string; sourceData: Prisma.JsonValue; validationErrors: Prisma.JsonValue; productId: string | null }[] }) {
  return { ...item, expiresAt: item.expiresAt.toISOString(), confirmedAt: item.confirmedAt?.toISOString() ?? null, createdAt: item.createdAt.toISOString() };
}

export async function GET(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.SELLER) || session.portal !== "seller") return apiError("SELLER_ACCESS_REQUIRED", "Seller access is required.", 403);
  const seller = await approvedSeller(session.userId);
  if (!seller) return apiError("SELLER_NOT_FOUND", "Seller profile not found.", 404);
  await prisma.sellerCatalogImport.updateMany({ where: { sellerProfileId: seller.id, status: "PREVIEW_READY", expiresAt: { lte: new Date() } }, data: { status: "EXPIRED", version: { increment: 1 } } });
  const imports = await prisma.sellerCatalogImport.findMany({ where: { sellerProfileId: seller.id }, include: { rows: { select: { rowNumber: true, status: true, sourceData: true, validationErrors: true, productId: true }, orderBy: { rowNumber: "asc" } } }, orderBy: { createdAt: "desc" }, take: 10 });
  return apiSuccess({ imports: imports.map(importView) }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function POST(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.SELLER) || session.portal !== "seller") return apiError("SELLER_ACCESS_REQUIRED", "Seller access is required.", 403);
  const seller = await approvedSeller(session.userId);
  if (!seller) return apiError("SELLER_NOT_FOUND", "Seller profile not found.", 404);
  if (seller.status !== "APPROVED") return apiError("SELLER_NOT_APPROVED", "Your seller account must be approved before products can be imported.", 403);
  const parsed = catalogImportPreviewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Provide a valid CSV preview.", 422);
  const mappingResult = validateImportMapping(parsed.data.headers, parsed.data.mapping);
  if ("error" in mappingResult) return apiError("INVALID_COLUMN_MAPPING", mappingResult.error ?? "Provide a valid column mapping.", 422);
  const { mapping } = mappingResult;
  const fingerprint = createImportFingerprint(parsed.data.headers, parsed.data.rows, mapping);
  const completed = await prisma.sellerCatalogImport.findFirst({ where: { sellerProfileId: seller.id, fingerprint, status: "COMPLETED" }, select: { id: true } });
  if (completed) return apiError("CATALOG_FILE_ALREADY_IMPORTED", "This exact mapped catalog was already imported.", 409, { importId: completed.id });
  const existing = await prisma.sellerCatalogImport.findFirst({ where: { sellerProfileId: seller.id, fingerprint, status: "PREVIEW_READY", expiresAt: { gt: new Date() } }, include: { rows: { select: { rowNumber: true, status: true, sourceData: true, validationErrors: true, productId: true }, orderBy: { rowNumber: "asc" } } } });
  if (existing) return apiSuccess({ catalogImport: importView(existing), reused: true }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });

  const [categories, variants] = await Promise.all([
    prisma.category.findMany({ where: { isActive: true }, select: { id: true, slug: true } }),
    prisma.productVariant.findMany({ where: { sku: { not: null } }, select: { sku: true } }),
  ]);
  const rows = buildCatalogImportRows(parsed.data.headers, parsed.data.rows, mapping, categories, new Set(variants.flatMap((variant) => variant.sku ? [variant.sku] : [])));
  const validRows = rows.filter((row) => row.status === "VALID").length;
  const expiresAt = new Date(Date.now() + IMPORT_PREVIEW_MINUTES * 60_000);
  const catalogImport = await prisma.$transaction(async (tx) => {
    await tx.sellerCatalogImport.updateMany({ where: { sellerProfileId: seller.id, status: "PREVIEW_READY", expiresAt: { lte: new Date() } }, data: { status: "EXPIRED", version: { increment: 1 } } });
    const created = await tx.sellerCatalogImport.create({
      data: {
        sellerProfileId: seller.id,
        originalFilename: parsed.data.originalFilename,
        fingerprint,
        mapping: mapping as Prisma.InputJsonValue,
        totalRows: rows.length,
        validRows,
        invalidRows: rows.length - validRows,
        expiresAt,
        rows: { create: rows.map((row) => ({ rowNumber: row.rowNumber, status: row.status, sourceData: row.sourceData as Prisma.InputJsonValue, normalizedData: row.normalizedData as Prisma.InputJsonValue | undefined, validationErrors: row.validationErrors as Prisma.InputJsonValue, fingerprint: row.fingerprint })) },
      },
      include: { rows: { select: { rowNumber: true, status: true, sourceData: true, validationErrors: true, productId: true }, orderBy: { rowNumber: "asc" } } },
    });
    await tx.auditLog.create({ data: { actorId: session.userId, action: "seller.catalog_import_previewed", entityType: "SellerCatalogImport", entityId: created.id, metadata: { totalRows: created.totalRows, validRows: created.validRows, invalidRows: created.invalidRows, fingerprint: fingerprint.slice(0, 16), expiresAt: expiresAt.toISOString() } } });
    return created;
  });
  return apiSuccess({ catalogImport: importView(catalogImport), reused: false }, { status: 201, headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
