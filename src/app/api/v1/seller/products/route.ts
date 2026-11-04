import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { sellerProductInputSchema } from "@/modules/catalog/seller-product-input";
import { createSellerProduct } from "@/modules/catalog/seller-product-creation";

export async function POST(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.SELLER) || session.portal !== "seller") return apiError("SELLER_ACCESS_REQUIRED", "Seller access is required.", 403);

  const seller = await prisma.sellerProfile.findUnique({
    where: { userId: session.userId },
    select: { id: true, status: true, originCountryCode: true, shipsInternationally: true },
  });
  if (!seller) return apiError("SELLER_NOT_FOUND", "Seller profile not found.", 404);
  if (seller.status !== "APPROVED") return apiError("SELLER_NOT_APPROVED", "Your seller account must be approved before products can be submitted.", 403);

  const parsed = sellerProductInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Please check the product details.", 422, { fields: parsed.error.flatten().fieldErrors });
  let product;
  try {
    product = await prisma.$transaction((tx) => createSellerProduct(tx, parsed.data, seller, session.userId, "MANUAL"));
  } catch (error) {
    if (error instanceof Error && error.message === "CATEGORY_NOT_AVAILABLE") return apiError("CATEGORY_NOT_AVAILABLE", "Choose an active product category.", 422);
    if (error instanceof Error && error.message === "SKU_ALREADY_USED") return apiError("SKU_ALREADY_USED", "This seller SKU is already assigned to another product.", 409);
    throw error;
  }
  return apiSuccess({ product }, { status: 201 });
}
