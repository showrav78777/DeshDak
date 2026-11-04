import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { getCartSummary, isVariantAvailable } from "@/modules/cart/summary";

const updateSchema = z.object({ quantity: z.coerce.number().int().min(1).max(99) });

async function customer(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session) return { error: apiError("AUTHENTICATION_REQUIRED", "Please sign in to change your cart.", 401) };
  if (!session.roles.includes(ROLE.CUSTOMER_PERSONAL)) return { error: apiError("CUSTOMER_ACCESS_REQUIRED", "A customer account is required.", 403) };
  return { session };
}

export async function PATCH(request: NextRequest, context: RouteContext<"/api/v1/cart/items/[itemId]">) {
  const access = await customer(request);
  if ("error" in access) return access.error;
  const { itemId } = await context.params;
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Quantity must be between 1 and 99.", 422, z.treeifyError(parsed.error));
  const existing = await prisma.cartItem.findFirst({ where: { id: itemId, cart: { userId: access.session.userId, currency: "BDT" } }, include: { productVariant: { select: { priceBdt: true, stockStatus: true, inventoryQuantity: true, product: { select: { status: true, complianceStatus: true, deletedAt: true, sellerProfileId: true, sellerProfile: { select: { status: true } }, category: { select: { isActive: true } } } } } } } });
  if (!existing) return apiError("CART_ITEM_NOT_FOUND", "Cart item was not found.", 404);
  if (!isVariantAvailable(existing.productVariant)) return apiError("PRODUCT_OPTION_UNAVAILABLE", "Remove this unavailable product option from your cart.", 409);
  if (existing.productVariant.inventoryQuantity !== null && parsed.data.quantity > existing.productVariant.inventoryQuantity) return apiError("INSUFFICIENT_INVENTORY", `Only ${existing.productVariant.inventoryQuantity} item(s) are currently available.`, 409);
  await prisma.$transaction([
    prisma.cartItem.update({ where: { id: existing.id }, data: { quantity: parsed.data.quantity } }),
    prisma.auditLog.create({ data: { actorId: access.session.userId, action: "cart.item_quantity_changed", entityType: "CartItem", entityId: existing.id, metadata: { quantity: parsed.data.quantity } } }),
  ]);
  const cart = await getCartSummary(access.session.userId);
  return apiSuccess({ cart }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function DELETE(request: NextRequest, context: RouteContext<"/api/v1/cart/items/[itemId]">) {
  const access = await customer(request);
  if ("error" in access) return access.error;
  const { itemId } = await context.params;
  const existing = await prisma.cartItem.findFirst({ where: { id: itemId, cart: { userId: access.session.userId, currency: "BDT" } }, select: { id: true } });
  if (!existing) return apiError("CART_ITEM_NOT_FOUND", "Cart item was not found.", 404);
  await prisma.$transaction([
    prisma.cartItem.delete({ where: { id: existing.id } }),
    prisma.auditLog.create({ data: { actorId: access.session.userId, action: "cart.item_removed", entityType: "CartItem", entityId: existing.id } }),
  ]);
  const cart = await getCartSummary(access.session.userId);
  return apiSuccess({ cart }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
