import { type NextRequest } from "next/server";

import { apiError } from "@/lib/api";
import { getRequestSession } from "@/lib/request-session";
import { renderBarcodeSvg, svgResponse } from "@/modules/identifiers/assets";
import { productIdentifierAccess } from "@/modules/identifiers/product-access";
import { isPlatformCode } from "@/modules/identifiers/service";

export async function GET(request: NextRequest, context: RouteContext<"/api/v1/identifiers/products/[productCode]/barcode">) {
  const { productCode } = await context.params;
  if (!isPlatformCode(productCode) || !productCode.startsWith("PRD-")) return apiError("PRODUCT_NOT_FOUND", "Product was not found.", 404);
  const access = await productIdentifierAccess(productCode, await getRequestSession(request));
  if (!access) return apiError("PRODUCT_NOT_FOUND", "Product was not found.", 404);
  return svgResponse(renderBarcodeSvg(productCode), productCode, "barcode", access.isPublic ? "public" : "private");
}
