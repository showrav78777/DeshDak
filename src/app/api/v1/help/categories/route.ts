import { apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const categories = await prisma.helpCategory.findMany({
    where: { isActive: true },
    select: {
      id: true,
      slug: true,
      nameEn: true,
      nameBn: true,
      descriptionEn: true,
      descriptionBn: true,
      _count: { select: { articles: { where: { status: "PUBLISHED" } } } },
    },
    orderBy: [{ sortOrder: "asc" }, { nameEn: "asc" }],
  });
  return apiSuccess({ categories: categories.map(({ _count, ...category }) => ({ ...category, articleCount: _count.articles })) }, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } });
}
