import { Prisma } from "@prisma/client";

import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { publicHelpSearchSchema } from "@/modules/help/schemas";

export async function GET(request: globalThis.Request) {
  const parsed = publicHelpSearchSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Check the Help Centre filters.", 422);
  const { q, category, limit, offset } = parsed.data;
  const where: Prisma.HelpArticleWhereInput = {
    status: "PUBLISHED",
    category: { isActive: true, ...(category ? { slug: category } : {}) },
    ...(q ? { OR: [
      { titleEn: { contains: q, mode: "insensitive" } },
      { titleBn: { contains: q, mode: "insensitive" } },
      { summaryEn: { contains: q, mode: "insensitive" } },
      { summaryBn: { contains: q, mode: "insensitive" } },
      { bodyEn: { contains: q, mode: "insensitive" } },
      { bodyBn: { contains: q, mode: "insensitive" } },
      { keywords: { has: q.toLowerCase() } },
    ] } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.helpArticle.findMany({ where, select: { id: true, slug: true, titleEn: true, titleBn: true, summaryEn: true, summaryBn: true, isFeatured: true, publishedAt: true, updatedAt: true, category: { select: { slug: true, nameEn: true, nameBn: true } } }, orderBy: [{ isFeatured: "desc" }, { sortOrder: "asc" }, { publishedAt: "desc" }, { id: "asc" }], skip: offset, take: limit }),
    prisma.helpArticle.count({ where }),
  ]);
  return apiSuccess({ items, total, limit, offset, hasMore: offset + items.length < total }, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } });
}
