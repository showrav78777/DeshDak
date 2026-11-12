import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { getSecurityCleanupConfiguration, SECURITY_CLEANUP_KEY } from "@/modules/maintenance/security-cleanup";

const schema = z.object({ securityTokenRetentionDays: z.coerce.number().int().min(1).max(365), rateLimitRetentionHours: z.coerce.number().int().min(1).max(720), mfaEnrollmentRetentionHours: z.coerce.number().int().min(1).max(168), inventoryBatchSize: z.coerce.number().int().min(1).max(500) });

export async function GET(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin" || !session.mfaVerifiedAt) return apiError("ADMIN_ACCESS_REQUIRED", "Administrator access is required.", 403);
  const configuration = await getSecurityCleanupConfiguration();
  return apiSuccess({ configuration }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function PATCH(request: NextRequest) {
  if (!hasTrustedMutationOrigin(request)) return apiError("INVALID_ORIGIN", "The request origin could not be verified.", 403);
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin" || !session.mfaVerifiedAt) return apiError("ADMIN_ACCESS_REQUIRED", "Administrator access is required.", 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Check the cleanup retention and batch settings.", 422, z.treeifyError(parsed.error));
  const configuration = await prisma.$transaction(async (tx) => {
    const updated = await tx.maintenanceConfiguration.upsert({ where: { key: SECURITY_CLEANUP_KEY }, update: { ...parsed.data, updatedById: session.userId }, create: { key: SECURITY_CLEANUP_KEY, ...parsed.data, updatedById: session.userId } });
    await tx.auditLog.create({ data: { actorId: session.userId, action: "maintenance.security_cleanup_configuration_updated", entityType: "MaintenanceConfiguration", entityId: SECURITY_CLEANUP_KEY, metadata: parsed.data } });
    return updated;
  });
  return apiSuccess({ configuration });
}
