import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";

const schema = z.object({ name: z.string().trim().min(3).max(100), country: z.string().trim().length(2).toUpperCase(), type: z.enum(["ORIGIN", "DESTINATION", "TRANSIT"]), address: z.string().trim().max(500).optional() });

export async function POST(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN)) return apiError("ADMIN_ACCESS_REQUIRED", "Admin access is required.", 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Please check the warehouse details.", 422, z.treeifyError(parsed.error));
  const warehouse = await prisma.$transaction(async (tx) => {
    const created = await tx.warehouse.create({ data: parsed.data });
    await tx.auditLog.create({ data: { actorId: session.userId, action: "warehouse.created", entityType: "Warehouse", entityId: created.id, metadata: { country: created.country, type: created.type } } });
    return created;
  });
  return apiSuccess({ warehouse }, { status: 201 });
}
