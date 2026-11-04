import { apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const categories = await prisma.category.findMany({
    where: { isActive: true },
    select: {
      id: true, slug: true, nameEn: true, nameBn: true, description: true, icon: true,
      sortOrder: true, parentId: true, showOnHomepage: true,
      _count: { select: { products: { where: { status: "ACTIVE", complianceStatus: "CLEAR", deletedAt: null, OR: [{ sellerProfileId: null }, { sellerProfile: { status: "APPROVED" } }] } } } },
    },
    orderBy: [{ sortOrder: "asc" }, { nameEn: "asc" }],
  });
  return apiSuccess({ categories: categories.map(({ _count, ...category }) => ({ ...category, productCount: _count.products })) }, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } });
}
