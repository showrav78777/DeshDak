import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";

const optionalText = (max: number) => z.preprocess((value) => value === "" || value === null ? null : value, z.string().trim().max(max).nullable());
const schema = z.object({ slug: z.string().trim().toLowerCase().min(2).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), nameEn: z.string().trim().min(2).max(100), nameBn: optionalText(100), description: optionalText(300), icon: optionalText(12), sortOrder: z.coerce.number().int().min(0).max(10_000).default(0), parentId: z.preprocess((value) => value === "" || value === null ? null : value, z.string().uuid().nullable()), isActive: z.boolean().default(false), showOnHomepage: z.boolean().default(false) }).strict();

export async function GET(request: NextRequest) {
  const session = await getRequestSession(request); if (!session?.roles.includes(ROLE.ADMIN)) return apiError("ADMIN_ACCESS_REQUIRED", "Admin access is required.", 403);
  const categories = await prisma.category.findMany({ include: { parent: { select: { id: true, nameEn: true } }, _count: { select: { products: true, children: true } } }, orderBy: [{ sortOrder: "asc" }, { nameEn: "asc" }] });
  return apiSuccess({ categories });
}

export async function POST(request: NextRequest) {
  const session = await getRequestSession(request); if (!session?.roles.includes(ROLE.ADMIN)) return apiError("ADMIN_ACCESS_REQUIRED", "Admin access is required.", 403);
  const parsed = schema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Provide valid category details.", 422);
  if (parsed.data.isActive || parsed.data.showOnHomepage) return apiError("CATEGORY_MUST_START_INACTIVE", "New categories must be reviewed after creation and start inactive.", 422);
  if (parsed.data.parentId) { const parent = await prisma.category.findUnique({ where: { id: parsed.data.parentId }, select: { id: true } }); if (!parent) return apiError("PARENT_CATEGORY_NOT_FOUND", "Parent category was not found.", 404); }
  try { const category = await prisma.$transaction(async (tx) => { const created = await tx.category.create({ data: parsed.data }); await tx.auditLog.create({ data: { actorId: session.userId, action: "category.created", entityType: "Category", entityId: created.id, metadata: { slug: created.slug, parentId: created.parentId, isActive: false } } }); return created; }); return apiSuccess({ category }, { status: 201 }); }
  catch (error) { if ((error as { code?: string }).code === "P2002") return apiError("CATEGORY_SLUG_EXISTS", "This category URL slug already exists.", 409); throw error; }
}
