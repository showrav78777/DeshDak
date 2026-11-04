import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ productId: string }> }) {
  const session = await getRequestSession(request);
  if (!session) return apiError("AUTHENTICATION_REQUIRED", "Please sign in to update your wishlist.", 401);
  if (!session.roles.includes(ROLE.CUSTOMER_PERSONAL)) return apiError("CUSTOMER_ACCESS_REQUIRED", "A customer account is required.", 403);
  const { productId } = await params;
  const removed = await prisma.$transaction(async (tx) => {
    const item = await tx.wishlistItem.findUnique({ where: { userId_productId: { userId: session.userId, productId } }, select: { id: true } });
    if (!item) return false;
    await tx.wishlistItem.delete({ where: { id: item.id } });
    await tx.auditLog.create({ data: { actorId: session.userId, action: "wishlist.item_removed", entityType: "WishlistItem", entityId: item.id, metadata: { productId } } });
    return true;
  });
  return apiSuccess({ productId, removed }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
