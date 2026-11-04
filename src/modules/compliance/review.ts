import "server-only";

import { prisma } from "@/lib/prisma";
import { rescreenPublicCatalog } from "@/modules/compliance/restricted-goods";

export type ComplianceReviewInput = { screeningId: string; reviewerId: string; decision: "APPROVED" | "REJECTED"; note: string; version: number };

export async function decideComplianceScreening(input: ComplianceReviewInput) {
  const current = await prisma.complianceScreeningAttempt.findUnique({ where: { id: input.screeningId } });
  if (!current) return { outcome: "NOT_FOUND" as const };
  if (current.outcome !== "REVIEW_REQUIRED") return { outcome: "STATE_CONFLICT" as const };
  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const changed = await tx.complianceScreeningAttempt.updateMany({ where: { id: input.screeningId, outcome: "REVIEW_REQUIRED", version: input.version }, data: { outcome: input.decision, reviewNote: input.note, reviewedById: input.reviewerId, reviewedAt: now, version: { increment: 1 } } });
    if (changed.count !== 1) return null;
    const screening = await tx.complianceScreeningAttempt.findUniqueOrThrow({ where: { id: input.screeningId } });
    const publicCatalog = screening.subject === "PRODUCT_PUBLICATION" && input.decision === "APPROVED"
      ? await rescreenPublicCatalog(tx)
      : screening.subject === "PRODUCT_PUBLICATION" && screening.subjectReference
        ? await tx.product.updateMany({ where: { id: screening.subjectReference, complianceStatus: "REVIEW_REQUIRED" }, data: { complianceStatus: "BLOCKED", complianceScreenedAt: now } }).then(({ count }) => ({ rejectedProducts: count }))
        : null;
    await tx.auditLog.create({ data: { actorId: input.reviewerId, action: `compliance.screening_${input.decision.toLowerCase()}`, entityType: "ComplianceScreeningAttempt", entityId: screening.id, metadata: { subject: screening.subject, matchedRuleCodes: screening.matchedRuleCodes, note: input.note, publicCatalog } } });
    return screening;
  });
  return updated ? { outcome: "UPDATED" as const, screening: updated } : { outcome: "VERSION_CONFLICT" as const };
}
