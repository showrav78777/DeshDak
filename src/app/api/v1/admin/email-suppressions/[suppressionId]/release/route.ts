import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { lockEmailRecipient } from "@/modules/notifications/email-events";
import { suppressionReviewSchema } from "@/modules/notifications/suppression-review";

export async function POST(request: NextRequest, context: { params: Promise<{ suppressionId: string }> }) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin" || !session.mfaVerifiedAt) return apiError("ADMIN_MFA_REQUIRED", "Administrator access with completed MFA is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "Review must originate from the protected Admin application.", 403);
  const parsed = suppressionReviewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Provide a review reason, safe evidence reference, version and confirmation.", 422);
  const { suppressionId } = await context.params;
  const data = parsed.data;
  try {
    const result = await prisma.$transaction(async tx => {
      const item = await tx.emailSuppression.findUnique({ where: { id: suppressionId } });
      if (!item) return "MISSING";
      await lockEmailRecipient(tx, item.recipientHash);
      const current = await tx.emailSuppression.findUniqueOrThrow({ where: { id: item.id } });
      if (!current.active && current.version === data.version + 1 && current.releasedById === session.userId && current.releaseReason === data.reason && current.evidenceReference === data.evidenceReference) return "REPLAY";
      if (!current.active || current.version !== data.version) return "CONFLICT";
      const changed = await tx.emailSuppression.updateMany({ where: { id: item.id, active: true, version: data.version }, data: { active: false, version: { increment: 1 }, releasedAt: new Date(), releasedById: session.userId, releaseReason: data.reason, evidenceReference: data.evidenceReference } });
      if (changed.count !== 1) return "CONFLICT";
      await tx.auditLog.create({ data: { actorId: session.userId, action: "notification.email_suppression_released", entityType: "EmailSuppression", entityId: item.id, metadata: { previousVersion: data.version, reason: data.reason, evidenceReference: data.evidenceReference, verificationConfirmed: true } } });
      return "RELEASED";
    });
    if (result === "MISSING") return apiError("SUPPRESSION_NOT_FOUND", "Suppression record was not found.", 404);
    if (result === "CONFLICT") return apiError("SUPPRESSION_VERSION_CONFLICT", "The suppression changed. Reload and review current evidence.", 409);
    return apiSuccess({ released: true, replayed: result === "REPLAY" }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch { return apiError("SUPPRESSION_RETRY_REQUIRED", "Review could not be confirmed. Retry the same reviewed request.", 503); }
}
