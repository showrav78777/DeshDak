import { type NextRequest } from "next/server";

import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { helpCategoryUpdateSchema } from "@/modules/help/schemas";

export async function PATCH(request: NextRequest, context: RouteContext<"/api/v1/admin/help/categories/[categoryId]">) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") return apiError("ADMIN_ACCESS_REQUIRED", "Admin access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "This change must originate from the protected Admin application.", 403);
  const parsed = helpCategoryUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Check the category settings.", 422);
  const { categoryId } = await context.params;
  const existing = await prisma.helpCategory.findUnique({ where: { id: categoryId }, select: { id: true, slug: true, version: true } });
  if (!existing) return apiError("HELP_CATEGORY_NOT_FOUND", "Help Centre category was not found.", 404);
  const { version, ...changes } = parsed.data;
  const result = await prisma.$transaction(async (tx) => {
    const changed = await tx.helpCategory.updateMany({ where: { id: categoryId, version }, data: { ...changes, updatedById: session.userId, version: { increment: 1 } } });
    if (changed.count !== 1) return null;
    const category = await tx.helpCategory.findUniqueOrThrow({ where: { id: categoryId }, include: { _count: { select: { articles: true } } } });
    await tx.auditLog.create({ data: { actorId: session.userId, action: "help.category_updated", entityType: "HelpCategory", entityId: categoryId, metadata: { slug: existing.slug, changedFields: Object.keys(changes), version: category.version } } });
    return category;
  });
  if (!result) return apiError("HELP_CATEGORY_CHANGED", "This category changed in another session. Refresh and try again.", 409);
  return apiSuccess({ category: result });
}
