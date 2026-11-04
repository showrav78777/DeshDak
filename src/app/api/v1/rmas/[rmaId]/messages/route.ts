import { type NextRequest } from "next/server";

import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { createTransactionalNotification } from "@/modules/notifications/service";
import { rmaMessageSchema } from "@/modules/rma/schemas";

export async function POST(request: NextRequest, context: RouteContext<"/api/v1/rmas/[rmaId]/messages">) {
  const session = await getRequestSession(request);
  if (!session) return apiError("AUTHENTICATION_REQUIRED", "Sign in to send a claim message.", 401);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "This update must originate from the protected application.", 403);
  const parsed = rmaMessageSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Check the message.", 422);
  const { rmaId } = await context.params;
  const rma = await prisma.rma.findUnique({ where: { id: rmaId }, select: { id: true, reference: true, customerId: true, status: true } });
  const isAdmin = session.portal === "admin" && session.roles.includes(ROLE.ADMIN);
  const isCustomer = session.portal === "customer" && rma?.customerId === session.userId;
  if (!rma || (!isAdmin && !isCustomer)) return apiError("RMA_NOT_FOUND", "Claim was not found.", 404);
  if (["REFUNDED", "REPLACED", "CLOSED"].includes(rma.status)) return apiError("RMA_CLOSED", "Messages cannot be added after this claim is resolved.", 409);
  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.rmaMessage.create({ data: { rmaId, senderId: session.userId, body: parsed.data.body, evidenceRefs: parsed.data.evidenceReferences.length ? parsed.data.evidenceReferences : undefined } });
    await tx.auditLog.create({ data: { actorId: session.userId, action: isAdmin ? "rma.admin_message_added" : "rma.customer_message_added", entityType: "Rma", entityId: rma.id, metadata: { messageId: created.id, evidenceCount: parsed.data.evidenceReferences.length } } });
    if (isAdmin) await createTransactionalNotification(tx, { userId: rma.customerId, eventType: "RMA_MESSAGE", title: `Update on ${rma.reference}`, body: parsed.data.body.slice(0, 300), deepLink: `/rmas/${rma.id}`, entityType: "Rma", entityId: rma.id, idempotencyKey: `rma-message:${created.id}` });
    return created;
  });
  return apiSuccess({ message }, { status: 201, headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
