import { createHash } from "node:crypto";
import { Prisma, type SupportSatisfactionRating } from "@prisma/client";
import { type NextRequest } from "next/server";

import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { createTransactionalNotification } from "@/modules/notifications/service";
import { supportSatisfactionSchema } from "@/modules/support/schemas";

const noStore = { "Cache-Control": "private, no-store, max-age=0" };

function responseRating(rating: SupportSatisfactionRating) {
  return {
    id: rating.id,
    score: rating.score,
    issueResolved: rating.issueResolved,
    comment: rating.comment,
    ticketVersion: rating.ticketVersion,
    submittedAt: rating.submittedAt,
  };
}

export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/v1/tickets/[ticketId]/satisfaction">,
) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.CUSTOMER_PERSONAL) || session.portal !== "customer") {
    return apiError("CUSTOMER_ACCESS_REQUIRED", "Customer sign-in is required to rate support.", 401);
  }
  if (!hasTrustedMutationOrigin(request)) {
    return apiError("UNTRUSTED_ORIGIN", "This feedback must originate from the protected customer application.", 403);
  }

  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
  if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 200) {
    return apiError("IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required.", 400);
  }
  const parsed = supportSatisfactionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Check your feedback.", 422);
  }

  const { ticketId } = await context.params;
  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, customerId: session.userId },
    select: {
      id: true,
      reference: true,
      customerId: true,
      assignedAgentId: true,
      status: true,
      resolvedAt: true,
      version: true,
    },
  });
  if (!ticket) return apiError("TICKET_NOT_FOUND", "Support request was not found.", 404);
  if (!["RESOLVED", "CLOSED"].includes(ticket.status) || !ticket.resolvedAt || !ticket.assignedAgentId) {
    return apiError("SATISFACTION_NOT_AVAILABLE", "Feedback is available after an assigned agent resolves the request.", 409);
  }

  const requestFingerprint = createHash("sha256").update(JSON.stringify({
    ticketId: ticket.id,
    customerId: session.userId,
    score: parsed.data.score,
    issueResolved: parsed.data.issueResolved,
    comment: parsed.data.comment,
  })).digest("hex");

  const replay = await prisma.supportSatisfactionRating.findUnique({ where: { idempotencyKey } });
  if (replay) {
    if (replay.ticketId !== ticket.id || replay.customerId !== session.userId || replay.requestFingerprint !== requestFingerprint) {
      return apiError("IDEMPOTENCY_KEY_CONFLICT", "This Idempotency-Key was already used for different feedback.", 409);
    }
    return apiSuccess({ rating: responseRating(replay), idempotentReplay: true }, { headers: noStore });
  }
  if (await prisma.supportSatisfactionRating.count({ where: { ticketId: ticket.id } })) {
    return apiError("SATISFACTION_ALREADY_SUBMITTED", "Feedback for this support request has already been submitted and cannot be changed.", 409);
  }

  try {
    const rating = await prisma.$transaction(async (tx) => {
      const created = await tx.supportSatisfactionRating.create({
        data: {
          ticketId: ticket.id,
          customerId: session.userId,
          agentId: ticket.assignedAgentId!,
          idempotencyKey,
          requestFingerprint,
          score: parsed.data.score,
          issueResolved: parsed.data.issueResolved,
          comment: parsed.data.comment,
          ticketVersion: ticket.version,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: session.userId,
          action: "support.satisfaction_submitted",
          entityType: "Ticket",
          entityId: ticket.id,
          metadata: {
            ratingId: created.id,
            agentId: ticket.assignedAgentId,
            score: created.score,
            issueResolved: created.issueResolved,
            ticketVersion: ticket.version,
          },
        },
      });
      if (created.score <= 2 || !created.issueResolved) {
        const administrators = await tx.user.findMany({
          where: { deletedAt: null, status: "ACTIVE", roles: { some: { role: { code: ROLE.ADMIN } } } },
          select: { id: true },
        });
        for (const administrator of administrators) {
          await createTransactionalNotification(tx, {
            userId: administrator.id,
            eventType: "SUPPORT_SATISFACTION_FOLLOW_UP",
            title: `Support follow-up needed · ${ticket.reference}`,
            body: `A customer reported ${created.score}/5 satisfaction or an unresolved issue. Review the protected ticket record.`,
            deepLink: `/admin/support/${ticket.id}`,
            entityType: "Ticket",
            entityId: ticket.id,
            priority: "HIGH",
            channels: ["IN_APP"],
            idempotencyKey: `support-satisfaction-follow-up:${created.id}:${administrator.id}`,
          });
        }
      }
      return created;
    });
    return apiSuccess({ rating: responseRating(rating), idempotentReplay: false }, { status: 201, headers: noStore });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const racedReplay = await prisma.supportSatisfactionRating.findUnique({ where: { idempotencyKey } });
      if (racedReplay?.ticketId === ticket.id && racedReplay.customerId === session.userId && racedReplay.requestFingerprint === requestFingerprint) {
        return apiSuccess({ rating: responseRating(racedReplay), idempotentReplay: true }, { headers: noStore });
      }
      if (await prisma.supportSatisfactionRating.count({ where: { ticketId: ticket.id } })) {
        return apiError("SATISFACTION_ALREADY_SUBMITTED", "Feedback for this support request has already been submitted and cannot be changed.", 409);
      }
      return apiError("IDEMPOTENCY_KEY_CONFLICT", "This Idempotency-Key was already used for different feedback.", 409);
    }
    throw error;
  }
}
