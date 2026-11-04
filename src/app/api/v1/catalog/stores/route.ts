import type { Prisma } from "@prisma/client";
import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim();
  const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") ?? 1) || 1);
  const pageSize = Math.min(48, Math.max(1, Number(request.nextUrl.searchParams.get("pageSize") ?? 18) || 18));
  if (query && query.length > 100) return apiError("INVALID_QUERY", "Search query is too long.", 422);
  const where: Prisma.SellerProfileWhereInput = {
    status: "APPROVED",
    storeSlug: { not: null },
    shipsInternationally: true,
    products: { some: { status: "ACTIVE", complianceStatus: "CLEAR", deletedAt: null, isInternationallyAvailable: true } },
    ...(query ? { OR: [{ storeCode: { contains: query, mode: "insensitive" } }, { businessName: { contains: query, mode: "insensitive" } }, { storeDescription: { contains: query, mode: "insensitive" } }] } : {}),
  };
  const [stores, total] = await prisma.$transaction([
    prisma.sellerProfile.findMany({ where, select: { id: true, storeCode: true, businessName: true, storeSlug: true, storeDescription: true, originCountryCode: true, shipsInternationally: true, processingDays: true, _count: { select: { products: { where: { status: "ACTIVE", complianceStatus: "CLEAR", deletedAt: null, isInternationallyAvailable: true } } } } }, orderBy: { businessName: "asc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.sellerProfile.count({ where }),
  ]);
  return apiSuccess({ stores: stores.map(({ _count, ...store }) => ({ ...store, productCount: _count.products })), meta: { page, pageSize, total, hasNextPage: page * pageSize < total } }, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } });
}
