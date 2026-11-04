import { Prisma } from "@prisma/client";
import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { createTransactionalNotification } from "@/modules/notifications/service";

const schema = z.object({ action: z.enum(["APPROVE", "REJECT"]), note: z.string().trim().min(5).max(1000) });

export async function PATCH(request: NextRequest, context: { params: Promise<{ quoteId: string }> }) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") return apiError("ADMIN_ACCESS_REQUIRED", "Administrator access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "This review must originate from the protected Admin application.", 403);
  const parsed = schema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return apiError("VALIDATION_ERROR", "Choose a decision and record an evidence-based note.", 422);
  const { quoteId } = await context.params;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const quote = await tx.sourcingQuote.findUnique({ where: { id: quoteId }, include: { sourcingRequest: { select: { id: true, reference: true, customerId: true, status: true } } } });
      if (!quote) return null; if (quote.status !== "DRAFT" || quote.sourcingRequest.status !== "UNDER_REVIEW") throw new Error("SOURCING_QUOTE_NOT_REVIEWABLE");
      if (quote.createdById === session.userId) throw new Error("INDEPENDENT_QUOTE_REVIEW_REQUIRED");
      if (parsed.data.action === "APPROVE" && quote.expiresAt <= new Date()) throw new Error("SOURCING_QUOTE_EXPIRED");
      const reviewedAt = new Date(); const status = parsed.data.action === "APPROVE" ? "SENT" : "REJECTED"; const requestStatus = parsed.data.action === "APPROVE" ? "QUOTED" : "SUBMITTED";
      const changed = await tx.sourcingQuote.updateMany({ where: { id: quote.id, status: "DRAFT" }, data: { status, reviewedById: session.userId, reviewedAt, reviewNote: parsed.data.note } }); if (changed.count !== 1) throw new Error("SOURCING_QUOTE_STATE_CHANGED");
      await tx.sourcingRequest.update({ where: { id: quote.sourcingRequestId }, data: { status: requestStatus } });
      await tx.auditLog.create({ data: { actorId: session.userId, action: `sourcing_quote.${parsed.data.action.toLowerCase()}`, entityType: "SourcingQuote", entityId: quote.id, metadata: { requestId: quote.sourcingRequestId, version: quote.version, totalBdt: quote.totalBdt.toString(), createdById: quote.createdById } } });
      await createTransactionalNotification(tx, { userId: quote.sourcingRequest.customerId, eventType: parsed.data.action === "APPROVE" ? "SOURCING_QUOTE_READY" : "SOURCING_QUOTE_REVISION_REQUIRED", title: parsed.data.action === "APPROVE" ? `Quote ready for ${quote.sourcingRequest.reference}` : `Quote review continues for ${quote.sourcingRequest.reference}`, body: parsed.data.action === "APPROVE" ? `Your reviewed quote is ready in Buy & Ship and remains valid until ${quote.expiresAt.toISOString()}.` : "Our sourcing team is correcting the draft before anything is shown for acceptance.", deepLink: "/buy-ship", entityType: "SourcingQuote", entityId: quote.id, priority: parsed.data.action === "APPROVE" ? "HIGH" : "NORMAL", idempotencyKey: `sourcing-quote-review:${quote.id}` });
      return tx.sourcingQuote.findUniqueOrThrow({ where: { id: quote.id } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (!result) return apiError("SOURCING_QUOTE_NOT_FOUND", "Quote draft was not found.", 404);
    return apiSuccess({ quote: result }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    const code = (error as Error).message;
    if (code === "SOURCING_QUOTE_NOT_REVIEWABLE" || code === "SOURCING_QUOTE_STATE_CHANGED") return apiError(code, "This quote changed and is no longer awaiting review.", 409);
    if (code === "INDEPENDENT_QUOTE_REVIEW_REQUIRED") return apiError(code, "The person who prepared a quote cannot approve it.", 409);
    if (code === "SOURCING_QUOTE_EXPIRED") return apiError(code, "This quote expired. Reject it so the Sourcing Agent can prepare a current draft.", 409);
    if ((error as { code?: string }).code === "P2034") return apiError("SOURCING_QUOTE_STATE_CHANGED", "Another review changed this quote. Refresh and try again.", 409);
    throw error;
  }
}
