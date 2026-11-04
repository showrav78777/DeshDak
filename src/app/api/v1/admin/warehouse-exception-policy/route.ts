import { type NextRequest } from "next/server";
import { z } from "zod";

import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { getWarehouseExceptionPolicy, WAREHOUSE_EXCEPTION_POLICY_KEY } from "@/modules/warehouse/exception-policy";

const schema = z.object({ expectedParcelAlertHours: z.coerce.number().int().min(1).max(2160), exceptionResolutionHours: z.coerce.number().int().min(1).max(720), storageWarningDays: z.coerce.number().int().min(1).max(365) });

export async function GET(request: NextRequest) {
  const session = await getRequestSession(request); if (!session?.roles.includes(ROLE.ADMIN)) return apiError("ADMIN_ACCESS_REQUIRED", "Admin access is required.", 403);
  return apiSuccess({ policy: await getWarehouseExceptionPolicy() }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function PATCH(request: NextRequest) {
  const session = await getRequestSession(request); if (!session?.roles.includes(ROLE.ADMIN)) return apiError("ADMIN_ACCESS_REQUIRED", "Admin access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "This policy must originate from the protected Admin application.", 403);
  const parsed = schema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return apiError("VALIDATION_ERROR", "Check the operational alert thresholds.", 422);
  const policy = await prisma.$transaction(async (tx) => {
    const updated = await tx.warehouseExceptionPolicy.upsert({ where: { key: WAREHOUSE_EXCEPTION_POLICY_KEY }, update: { ...parsed.data, updatedById: session.userId }, create: { key: WAREHOUSE_EXCEPTION_POLICY_KEY, ...parsed.data, updatedById: session.userId } });
    await tx.auditLog.create({ data: { actorId: session.userId, action: "admin.warehouse_exception_policy_updated", entityType: "WarehouseExceptionPolicy", entityId: WAREHOUSE_EXCEPTION_POLICY_KEY, metadata: parsed.data } });
    return updated;
  });
  return apiSuccess({ policy }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
