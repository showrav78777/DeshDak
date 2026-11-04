import { type NextRequest } from "next/server";

import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { productIdentifierAccess } from "@/modules/identifiers/product-access";
import { isPlatformCode } from "@/modules/identifiers/service";

export async function GET(request: NextRequest, context: RouteContext<"/api/v1/identifiers/products/[productCode]">) {
  const { productCode } = await context.params;
  if (!isPlatformCode(productCode) || !productCode.startsWith("PRD-")) return apiError("PRODUCT_NOT_FOUND", "Product was not found.", 404);
  const access = await productIdentifierAccess(productCode, await getRequestSession(request));
  if (!access) return apiError("PRODUCT_NOT_FOUND", "Product was not found.", 404);
  const product = await prisma.product.findFirst({
    where: { id: access.productId },
    select: { id: true, productCode: true, titleEn: true, titleBn: true, description: true, originCountryCode: true, isInternationallyAvailable: true, category: { select: { slug: true, nameEn: true, nameBn: true } }, variants: { select: { id: true, attributes: true, priceBdt: true, priceCurrency: true, inventoryQuantity: true, stockStatus: true }, orderBy: { createdAt: "asc" } } },
  });
  if (!product) return apiError("PRODUCT_NOT_FOUND", "Product was not found.", 404);
  return apiSuccess({ product, identifiers: { code: productCode, barcodeValue: productCode, qrAssetUrl: `/api/v1/identifiers/products/${productCode}/qr`, barcodeAssetUrl: `/api/v1/identifiers/products/${productCode}/barcode`, productUrl: access.isPublic ? `/products/${product.id}` : null } }, { headers: { "Cache-Control": access.isPublic ? "public, s-maxage=60, stale-while-revalidate=300" : "private, no-store, max-age=0" } });
}
