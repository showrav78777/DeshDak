import { type NextRequest } from "next/server";

import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { helpCategoryCreateSchema } from "@/modules/help/schemas";

export async function GET(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") return apiError("ADMIN_ACCESS_REQUIRED", "Admin access is required.", 403);
  const categories = await prisma.helpCategory.findMany({ include: { _count: { select: { articles: true } } }, orderBy: [{ sortOrder: "asc" }, { nameEn: "asc" }] });
  return apiSuccess({ categories }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function POST(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") return apiError("ADMIN_ACCESS_REQUIRED", "Admin access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "This change must originate from the protected Admin application.", 403);
  const parsed = helpCategoryCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Check the category details.", 422);
  try {
    const category = await prisma.$transaction(async (tx) => {
      const created = await tx.helpCategory.create({ data: { ...parsed.data, createdById: session.userId, updatedById: session.userId } });
      await tx.auditLog.create({ data: { actorId: session.userId, action: "help.category_created", entityType: "HelpCategory", entityId: created.id, metadata: { slug: created.slug, isActive: false } } });
      return created;
    });
    return apiSuccess({ category }, { status: 201 });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return apiError("HELP_CATEGORY_SLUG_EXISTS", "This Help Centre category URL already exists.", 409);
    throw error;
  }
}
