import { type NextRequest } from "next/server";

import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export async function GET(_request: NextRequest, context: RouteContext<"/api/v1/help/articles/[slug]">) {
  const { slug } = await context.params;
  const article = await prisma.helpArticle.findFirst({
    where: { slug, status: "PUBLISHED", category: { isActive: true } },
    select: { id: true, slug: true, titleEn: true, titleBn: true, summaryEn: true, summaryBn: true, bodyEn: true, bodyBn: true, keywords: true, publishedAt: true, updatedAt: true, category: { select: { slug: true, nameEn: true, nameBn: true } } },
  });
  if (!article) return apiError("HELP_ARTICLE_NOT_FOUND", "Help Centre article was not found.", 404);
  return apiSuccess({ article }, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } });
}
