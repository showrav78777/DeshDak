import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { publicWishlistProductWhere, wishlistProductSelect } from "@/modules/wishlist/catalog";

export async function GET(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session) return apiError("AUTHENTICATION_REQUIRED", "Please sign in to view your wishlist.", 401);
  if (!session.roles.includes(ROLE.CUSTOMER_PERSONAL)) return apiError("CUSTOMER_ACCESS_REQUIRED", "A customer account is required.", 403);
  const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") ?? 1) || 1);
  const pageSize = Math.min(48, Math.max(1, Number(request.nextUrl.searchParams.get("pageSize") ?? 24) || 24));
  const where = { userId: session.userId, product: { is: publicWishlistProductWhere } };
  const [items, total] = await prisma.$transaction([
    prisma.wishlistItem.findMany({ where, select: { id: true, createdAt: true, product: { select: wishlistProductSelect } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
    prisma.wishlistItem.count({ where }),
  ]);
  return apiSuccess({ items, meta: { page, pageSize, total, hasNextPage: page * pageSize < total } }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
