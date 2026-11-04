import { type NextRequest } from "next/server";

import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { helpArticleCreateSchema } from "@/modules/help/schemas";

export async function GET(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") return apiError("ADMIN_ACCESS_REQUIRED", "Admin access is required.", 403);
  const articles = await prisma.helpArticle.findMany({ include: { category: { select: { slug: true, nameEn: true, isActive: true } }, updatedBy: { select: { fullName: true } } }, orderBy: [{ updatedAt: "desc" }], take: 500 });
  return apiSuccess({ articles }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function POST(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") return apiError("ADMIN_ACCESS_REQUIRED", "Admin access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "This change must originate from the protected Admin application.", 403);
  const parsed = helpArticleCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Check the article details.", 422);
  if (!await prisma.helpCategory.count({ where: { id: parsed.data.categoryId } })) return apiError("HELP_CATEGORY_NOT_FOUND", "Choose an existing Help Centre category.", 404);
  try {
    const article = await prisma.$transaction(async (tx) => {
      const created = await tx.helpArticle.create({ data: { ...parsed.data, createdById: session.userId, updatedById: session.userId } });
      await tx.auditLog.create({ data: { actorId: session.userId, action: "help.article_created", entityType: "HelpArticle", entityId: created.id, metadata: { slug: created.slug, categoryId: created.categoryId, status: created.status } } });
      return created;
    });
    return apiSuccess({ article }, { status: 201 });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return apiError("HELP_ARTICLE_SLUG_EXISTS", "This Help Centre article URL already exists.", 409);
    throw error;
  }
}
