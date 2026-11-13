import "server-only";

import { lockActiveAccount } from "@/modules/auth/account-mutation";
import { prisma } from "@/lib/prisma";
import { rescreenPublicCatalog } from "@/modules/compliance/restricted-goods";

export type ComplianceReviewInput = { screeningId: string; reviewerId: string; sessionId: string; portal: "admin" | "compliance"; decision: "APPROVED" | "REJECTED"; note: string; version: number };

export async function decideComplianceScreening(input: ComplianceReviewInput) {
  return prisma.$transaction(async (tx) => {
    const active = await lockActiveAccount(tx, input.reviewerId, input.sessionId);
    const session = await tx.authSession.findUnique({ where: { id: input.sessionId }, select: { portal: true, mfaVerifiedAt: true, expiresAt: true } });
    await tx.$queryRaw`SELECT "roleId" FROM "UserRole" WHERE "userId" = ${input.reviewerId} FOR SHARE`;
    const grant = await tx.userRole.findFirst({ where: { userId: input.reviewerId, role: { code: input.portal } }, select: { roleId: true } });
    if (!active || !session || session.portal !== input.portal || !session.mfaVerifiedAt || session.expiresAt <= new Date() || !grant) {
      const actor = await tx.user.findUnique({ where: { id: input.reviewerId }, select: { id: true } });
      await tx.auditLog.create({ data: { actorId: actor?.id ?? null, action: "compliance.screening_review_denied", entityType: "ComplianceScreeningAttempt", metadata: { reason: "ACCESS_CHANGED" } } });
      return { outcome: "ACCESS_DENIED" } as const;
    }
    const current = await tx.complianceScreeningAttempt.findUnique({ where: { id: input.screeningId } });
    if (!current) return { outcome: "NOT_FOUND" } as const;
    if (current.outcome !== "REVIEW_REQUIRED") return { outcome: "STATE_CONFLICT" } as const;
    const now = new Date();
    const changed = await tx.complianceScreeningAttempt.updateMany({ where: { id: input.screeningId, outcome: "REVIEW_REQUIRED", version: input.version }, data: { outcome: input.decision, reviewNote: input.note, reviewedById: input.reviewerId, reviewedAt: now, version: { increment: 1 } } });
    if (changed.count !== 1) return { outcome: "VERSION_CONFLICT" } as const;
    const screening = await tx.complianceScreeningAttempt.findUniqueOrThrow({ where: { id: input.screeningId } });
    const publicCatalog = screening.subject === "PRODUCT_PUBLICATION" && input.decision === "APPROVED"
      ? await rescreenPublicCatalog(tx)
      : screening.subject === "PRODUCT_PUBLICATION" && screening.subjectReference
        ? await tx.product.updateMany({ where: { id: screening.subjectReference, complianceStatus: "REVIEW_REQUIRED" }, data: { complianceStatus: "BLOCKED", complianceScreenedAt: now } }).then(({ count }) => ({ rejectedProducts: count }))
        : null;
    await tx.auditLog.create({ data: { actorId: input.reviewerId, action: `compliance.screening_${input.decision.toLowerCase()}`, entityType: "ComplianceScreeningAttempt", entityId: screening.id, metadata: { subject: screening.subject, matchedRuleCodes: screening.matchedRuleCodes, note: input.note, publicCatalog } } });
    return { outcome: "UPDATED", screening } as const;
  });
}
