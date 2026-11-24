import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { launchReadinessUpdateSchema } from "@/modules/launch-readiness/schemas";
import { privateMediaImplementationBlocker } from "@/modules/launch-readiness/media-capabilities";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ itemId: string }> }) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") return apiError("ADMIN_ACCESS_REQUIRED", "Administrator access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "This change must originate from the protected Admin application.", 403);
  const parsed = launchReadinessUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Check the launch-readiness evidence.", 422);
  const { itemId } = await params;
  const { verificationConfirmed, version, ...input } = parsed.data;
  const verified = input.status === "VERIFIED" && verificationConfirmed;
  const result = await prisma.$transaction(async (tx) => {
    const current = await tx.launchReadinessItem.findUnique({ where: { id: itemId } });
    if (!current) return { code: "NOT_FOUND" as const };
    if (current.key === "private-media" && (verified || !input.isRequired)) {
      await tx.auditLog.create({ data: { actorId: session.userId, action: "launch_readiness.verification_blocked", entityType: "LaunchReadinessItem", entityId: current.id, metadata: { key: current.key, outcome: "PRIVATE_MEDIA_IMPLEMENTATION_REQUIRED" } } });
      return { code: "PRIVATE_MEDIA_IMPLEMENTATION_REQUIRED" as const };
    }
    const updated = await tx.launchReadinessItem.updateMany({ where: { id: itemId, version }, data: { ...input, updatedById: session.userId, verifiedById: verified ? session.userId : null, verifiedAt: verified ? new Date() : null, version: { increment: 1 } } });
    if (updated.count !== 1) return { code: "VERSION_CONFLICT" as const };
    const item = await tx.launchReadinessItem.findUniqueOrThrow({ where: { id: itemId }, include: { updatedBy: { select: { fullName: true, personCode: true } }, verifiedBy: { select: { fullName: true, personCode: true } } } });
    await tx.launchReadinessEvent.create({ data: { itemId: item.id, actorId: session.userId, fromStatus: current.status, toStatus: item.status, itemVersion: item.version, ownerNameSnapshot: item.ownerName, dueAtSnapshot: item.dueAt, evidenceReferenceSnapshot: item.evidenceReference, evidenceNoteSnapshot: item.evidenceNote, blockerReasonSnapshot: item.blockerReason } });
    await tx.auditLog.create({ data: { actorId: session.userId, action: "launch_readiness.item_updated", entityType: "LaunchReadinessItem", entityId: item.id, metadata: { key: item.key, category: item.category, fromStatus: current.status, toStatus: item.status, isRequired: item.isRequired, evidenceRecorded: Boolean(item.evidenceReference), version: item.version } } });
    return { item };
  });
  if ("code" in result && result.code === "NOT_FOUND") return apiError("LAUNCH_READINESS_NOT_FOUND", "This launch-readiness item no longer exists.", 404);
  if ("code" in result && result.code === "VERSION_CONFLICT") return apiError("VERSION_CONFLICT", "This item changed in another session. Refresh before saving.", 409);
  if ("code" in result && result.code === "PRIVATE_MEDIA_IMPLEMENTATION_REQUIRED") return apiError("PRIVATE_MEDIA_IMPLEMENTATION_REQUIRED", privateMediaImplementationBlocker, 409);
  return apiSuccess({ item: result.item });
}
