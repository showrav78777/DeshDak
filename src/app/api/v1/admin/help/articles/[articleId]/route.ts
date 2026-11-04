import { type NextRequest } from "next/server";

import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { helpArticleUpdateSchema } from "@/modules/help/schemas";

export async function PATCH(request: NextRequest, context: RouteContext<"/api/v1/admin/help/articles/[articleId]">) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") return apiError("ADMIN_ACCESS_REQUIRED", "Admin access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "This change must originate from the protected Admin application.", 403);
  const parsed = helpArticleUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Check the article settings.", 422);
  const { articleId } = await context.params;
  const existing = await prisma.helpArticle.findUnique({ where: { id: articleId }, include: { category: { select: { isActive: true } } } });
  if (!existing) return apiError("HELP_ARTICLE_NOT_FOUND", "Help Centre article was not found.", 404);
  if (existing.status === "ARCHIVED") return apiError("HELP_ARTICLE_ARCHIVED", "Archived articles are immutable. Create a new draft to publish revised guidance.", 409);
  const targetStatus = parsed.data.status ?? existing.status;
  const categoryId = parsed.data.categoryId ?? existing.categoryId;
  const category = categoryId === existing.categoryId ? existing.category : await prisma.helpCategory.findUnique({ where: { id: categoryId }, select: { isActive: true } });
  if (!category) return apiError("HELP_CATEGORY_NOT_FOUND", "Choose an existing Help Centre category.", 404);
  if (targetStatus === "PUBLISHED" && !category.isActive) return apiError("HELP_CATEGORY_NOT_PUBLIC", "Activate the category before publishing this article.", 409);
  if (parsed.data.isFeatured && targetStatus !== "PUBLISHED") return apiError("HELP_ARTICLE_NOT_PUBLIC", "Only a published article can be featured.", 409);
  const { version, ...requestedChanges } = parsed.data;
  const changes = { ...requestedChanges, ...(targetStatus !== "PUBLISHED" ? { isFeatured: false } : {}), ...(parsed.data.status === "PUBLISHED" && !existing.publishedAt ? { publishedAt: new Date() } : {}), updatedById: session.userId };
  const result = await prisma.$transaction(async (tx) => {
    const changed = await tx.helpArticle.updateMany({ where: { id: articleId, version, status: { not: "ARCHIVED" } }, data: { ...changes, version: { increment: 1 } } });
    if (changed.count !== 1) return null;
    const article = await tx.helpArticle.findUniqueOrThrow({ where: { id: articleId }, include: { category: { select: { slug: true, nameEn: true, isActive: true } }, updatedBy: { select: { fullName: true } } } });
    await tx.auditLog.create({ data: { actorId: session.userId, action: "help.article_updated", entityType: "HelpArticle", entityId: articleId, metadata: { slug: existing.slug, fromStatus: existing.status, toStatus: article.status, changedFields: Object.keys(requestedChanges), version: article.version } } });
    return article;
  });
  if (!result) return apiError("HELP_ARTICLE_CHANGED", "This article changed in another session. Refresh and try again.", 409);
  return apiSuccess({ article: result });
}
