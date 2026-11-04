import { type NextRequest } from "next/server";

import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { createTransactionalNotification } from "@/modules/notifications/service";
import { supportQualityReviewSchema } from "@/modules/support/schemas";

export async function PUT(request: NextRequest, context: RouteContext<"/api/v1/admin/support-quality-reviews/[ticketId]">) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") return apiError("ADMIN_ACCESS_REQUIRED", "Admin access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "This quality review must originate from the protected Admin application.", 403);
  const parsed = supportQualityReviewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Check the quality review.", 422);
  const { ticketId } = await context.params;
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { id: true, reference: true, status: true, assignedAgentId: true, qualityReview: { select: { id: true, version: true } } } });
  if (!ticket) return apiError("TICKET_NOT_FOUND", "Support request was not found.", 404);
  if (!ticket.assignedAgentId) return apiError("QUALITY_REVIEW_AGENT_REQUIRED", "Assign an agent before recording a quality review.", 409);
  if (!["RESOLVED", "CLOSED"].includes(ticket.status)) return apiError("QUALITY_REVIEW_NOT_READY", "Quality review is available after the ticket is resolved or closed.", 409);
  if (ticket.qualityReview && parsed.data.version !== ticket.qualityReview.version) return apiError("QUALITY_REVIEW_CHANGED", "This review changed after the page loaded. Refresh before saving.", 409);
  if (!ticket.qualityReview && parsed.data.version) return apiError("QUALITY_REVIEW_CHANGED", "Refresh before creating this quality review.", 409);
  const changes = { score: parsed.data.score, outcome: parsed.data.outcome, summary: parsed.data.summary, coachingAction: parsed.data.coachingAction };
  const nextVersion = (ticket.qualityReview?.version ?? 0) + 1;
  const review = await prisma.$transaction(async (tx) => {
    if (ticket.qualityReview) {
      const changed = await tx.supportQualityReview.updateMany({ where: { id: ticket.qualityReview.id, version: ticket.qualityReview.version }, data: { ...changes, reviewerId: session.userId, agentId: ticket.assignedAgentId!, reviewedAt: new Date(), version: { increment: 1 } } });
      if (changed.count !== 1) return null;
    } else {
      await tx.supportQualityReview.create({ data: { ticketId: ticket.id, agentId: ticket.assignedAgentId!, reviewerId: session.userId, ...changes } });
    }
    const saved = await tx.supportQualityReview.findUniqueOrThrow({ where: { ticketId: ticket.id } });
    await tx.auditLog.create({ data: { actorId: session.userId, action: ticket.qualityReview ? "support.quality_review_updated" : "support.quality_review_created", entityType: "SupportQualityReview", entityId: saved.id, metadata: { ticketId: ticket.id, agentId: saved.agentId, score: saved.score, outcome: saved.outcome, version: saved.version } } });
    await createTransactionalNotification(tx, { userId: saved.agentId, eventType: "SUPPORT_QUALITY_REVIEW", title: `Quality review for ${ticket.reference}`, body: `${saved.score}/5 · ${saved.outcome.replaceAll("_", " ")}`, deepLink: `/support/tickets/${ticket.reference}`, entityType: "SupportQualityReview", entityId: saved.id, priority: saved.outcome === "PASS" ? "NORMAL" : "HIGH", channels: ["IN_APP"], idempotencyKey: `support-quality-review:${saved.id}:${nextVersion}` });
    return saved;
  });
  if (!review) return apiError("QUALITY_REVIEW_CHANGED", "This quality review changed while saving. Refresh and review it.", 409);
  return apiSuccess({ review }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
