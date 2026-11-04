import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";

const optionalText = (max: number) => z.preprocess((value) => value === "" || value === null ? null : value, z.string().trim().max(max).nullable());
const schema = z.object({ nameEn: z.string().trim().min(2).max(100).optional(), nameBn: optionalText(100).optional(), description: optionalText(300).optional(), icon: optionalText(12).optional(), sortOrder: z.coerce.number().int().min(0).max(10_000).optional(), parentId: z.preprocess((value) => value === "" || value === null ? null : value, z.string().uuid().nullable()).optional(), isActive: z.boolean().optional(), showOnHomepage: z.boolean().optional() }).strict().refine((data) => Object.keys(data).length > 0, "Provide at least one category setting.");

export async function PATCH(request: NextRequest, context: { params: Promise<{ categoryId: string }> }) {
  const session = await getRequestSession(request); if (!session?.roles.includes(ROLE.ADMIN)) return apiError("ADMIN_ACCESS_REQUIRED", "Admin access is required.", 403);
  const parsed = schema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Provide valid category settings.", 422);
  const { categoryId } = await context.params; const existing = await prisma.category.findUnique({ where: { id: categoryId }, include: { children: { where: { isActive: true }, select: { id: true } }, parent: { select: { id: true, isActive: true } } } });
  if (!existing) return apiError("CATEGORY_NOT_FOUND", "Category was not found.", 404);
  if (parsed.data.parentId === categoryId) return apiError("CATEGORY_PARENT_INVALID", "A category cannot be its own parent.", 422);
  if (parsed.data.parentId) { const parent = await prisma.category.findUnique({ where: { id: parsed.data.parentId }, select: { id: true, parentId: true, isActive: true } }); if (!parent) return apiError("PARENT_CATEGORY_NOT_FOUND", "Parent category was not found.", 404); let ancestorId: string | null = parent.id; const visited = new Set<string>(); while (ancestorId) { if (ancestorId === categoryId) return apiError("CATEGORY_CYCLE", "This parent choice would create a category cycle.", 422); if (visited.has(ancestorId)) return apiError("CATEGORY_TREE_INVALID", "The existing category tree contains a cycle.", 409); visited.add(ancestorId); const ancestor: { parentId: string | null } | null = await prisma.category.findUnique({ where: { id: ancestorId }, select: { parentId: true } }); ancestorId = ancestor?.parentId ?? null; } if ((parsed.data.isActive ?? existing.isActive) && !parent.isActive) return apiError("PARENT_CATEGORY_INACTIVE", "Activate the parent category before this child category.", 409); }
  if (parsed.data.isActive === true && existing.parent && !existing.parent.isActive && parsed.data.parentId === undefined) return apiError("PARENT_CATEGORY_INACTIVE", "Activate the parent category before this child category.", 409);
  if (parsed.data.isActive === false && existing.children.length) return apiError("ACTIVE_CHILDREN_EXIST", "Disable active child categories first.", 409);
  if (parsed.data.showOnHomepage === true && parsed.data.isActive !== true && !existing.isActive) return apiError("CATEGORY_NOT_PUBLIC", "Activate the category before placing it on the homepage.", 409);
  const data = { ...parsed.data, ...(parsed.data.isActive === false ? { showOnHomepage: false } : {}) };
  const category = await prisma.$transaction(async (tx) => { const updated = await tx.category.update({ where: { id: categoryId }, data }); await tx.auditLog.create({ data: { actorId: session.userId, action: "category.settings_changed", entityType: "Category", entityId: categoryId, metadata: { slug: existing.slug, changed: data } } }); return updated; });
  return apiSuccess({ category });
}
