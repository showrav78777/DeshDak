import { Prisma } from "@prisma/client";
import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { publicWishlistProductWhere } from "@/modules/wishlist/catalog";

const schema = z.object({ productId: z.string().uuid() });

export async function POST(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session) return apiError("AUTHENTICATION_REQUIRED", "Please sign in to save products.", 401);
  if (!session.roles.includes(ROLE.CUSTOMER_PERSONAL)) return apiError("CUSTOMER_ACCESS_REQUIRED", "A customer account is required.", 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Choose a valid product.", 422, z.treeifyError(parsed.error));
  const product = await prisma.product.findFirst({ where: { id: parsed.data.productId, ...publicWishlistProductWhere }, select: { id: true } });
  if (!product) return apiError("PRODUCT_NOT_FOUND", "This product is not available to save.", 404);
  const existing = await prisma.wishlistItem.findUnique({ where: { userId_productId: { userId: session.userId, productId: product.id } }, select: { id: true, productId: true, createdAt: true } });
  if (existing) return apiSuccess({ item: existing, idempotentReplay: true }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  try {
    const item = await prisma.$transaction(async (tx) => {
      const saved = await tx.wishlistItem.create({ data: { userId: session.userId, productId: product.id }, select: { id: true, productId: true, createdAt: true } });
      await tx.auditLog.create({ data: { actorId: session.userId, action: "wishlist.item_saved", entityType: "WishlistItem", entityId: saved.id, metadata: { productId: product.id } } });
      return saved;
    });
    return apiSuccess({ item, idempotentReplay: false }, { status: 201, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    const raced = await prisma.wishlistItem.findUnique({ where: { userId_productId: { userId: session.userId, productId: product.id } }, select: { id: true, productId: true, createdAt: true } });
    if (!raced) throw error;
    return apiSuccess({ item: raced, idempotentReplay: true }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  }
}
