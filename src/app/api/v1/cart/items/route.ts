import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { getCartSummary, isVariantAvailable } from "@/modules/cart/summary";

const schema = z.object({ productVariantId: z.string().uuid(), quantity: z.coerce.number().int().min(1).max(99) });

export async function POST(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session) return apiError("AUTHENTICATION_REQUIRED", "Please sign in before adding an item to your cart.", 401);
  if (!session.roles.includes(ROLE.CUSTOMER_PERSONAL)) return apiError("CUSTOMER_ACCESS_REQUIRED", "A customer account is required.", 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Choose a valid product option and quantity.", 422, z.treeifyError(parsed.error));

  const variant = await prisma.productVariant.findUnique({ where: { id: parsed.data.productVariantId }, select: { id: true, priceBdt: true, stockStatus: true, inventoryQuantity: true, product: { select: { id: true, minimumOrderQuantity: true, status: true, complianceStatus: true, deletedAt: true, sellerProfileId: true, sellerProfile: { select: { status: true } }, category: { select: { isActive: true } } } } } });
  if (!variant || !isVariantAvailable(variant)) return apiError("PRODUCT_OPTION_UNAVAILABLE", "This product option is not currently available.", 409);
  if (parsed.data.quantity < variant.product.minimumOrderQuantity) return apiError("MINIMUM_ORDER_QUANTITY", `This product requires a minimum order of ${variant.product.minimumOrderQuantity}.`, 409);
  if (variant.inventoryQuantity !== null && parsed.data.quantity > variant.inventoryQuantity) return apiError("INSUFFICIENT_INVENTORY", `Only ${variant.inventoryQuantity} item(s) are currently available.`, 409);

  const existingCart = await prisma.cart.findUnique({ where: { userId_currency: { userId: session.userId, currency: "BDT" } }, select: { items: { take: 1, select: { productVariant: { select: { product: { select: { sellerProfileId: true } } } } } } } });
  const existingKind = existingCart?.items[0]?.productVariant.product.sellerProfileId ? "SELLER" : existingCart?.items.length ? "SOURCED" : null;
  const incomingKind = variant.product.sellerProfileId ? "SELLER" : "SOURCED";
  if (existingKind && existingKind !== incomingKind) return apiError("MIXED_FULFILLMENT_CART", "Seller products and sourced products use different fulfillment. Complete or clear this cart before adding this product.", 409);

  const item = await prisma.$transaction(async (tx) => {
    const cart = await tx.cart.upsert({ where: { userId_currency: { userId: session.userId, currency: "BDT" } }, update: {}, create: { userId: session.userId, currency: "BDT" }, select: { id: true } });
    const saved = await tx.cartItem.upsert({ where: { cartId_productVariantId: { cartId: cart.id, productVariantId: variant.id } }, update: { quantity: parsed.data.quantity }, create: { cartId: cart.id, productVariantId: variant.id, quantity: parsed.data.quantity } });
    await tx.auditLog.create({ data: { actorId: session.userId, action: "cart.item_saved", entityType: "CartItem", entityId: saved.id, metadata: { productId: variant.product.id, productVariantId: variant.id, quantity: parsed.data.quantity } } });
    return saved;
  });
  const cart = await getCartSummary(session.userId);
  return apiSuccess({ itemId: item.id, cart }, { status: 201, headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
