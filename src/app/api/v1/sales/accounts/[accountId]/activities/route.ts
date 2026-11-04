import { Prisma } from "@prisma/client";
import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { accountActivitySchema } from "@/modules/sales/schemas";

export async function POST(request: NextRequest, context: RouteContext<"/api/v1/sales/accounts/[accountId]/activities">) {
  const session = await getRequestSession(request); if (!session?.roles.includes(ROLE.KAM) || session.portal !== "sales") return apiError("KAM_ACCESS_REQUIRED", "Key Account Manager access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "Account activity must originate from the Sales application.", 403);
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim(); if (!idempotencyKey || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) return apiError("IDEMPOTENCY_KEY_REQUIRED", "A valid UUID Idempotency-Key header is required.", 400);
  const parsed = accountActivitySchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return apiError("VALIDATION_ERROR", "Check the activity details.", 422, { fields: parsed.error.flatten().fieldErrors });
  const { accountId } = await context.params;
  try {
    const activity = await prisma.$transaction(async (tx) => { const account = await tx.businessAccount.findFirst({ where: { id: accountId, status: "ACTIVE", assignments: { some: { userId: session.userId, isActive: true } } }, select: { id: true, ownerId: true, accountCode: true } }); if (!account) return null; if (parsed.data.sourcingRequestId && !(await tx.sourcingRequest.findFirst({ where: { id: parsed.data.sourcingRequestId, customerId: account.ownerId }, select: { id: true } }))) throw new Error("RFQ_ACCOUNT_MISMATCH"); const saved = await tx.accountActivity.create({ data: { accountId, authorId: session.userId, idempotencyKey, ...parsed.data } }); await tx.auditLog.create({ data: { actorId: session.userId, action: "sales.account_activity_recorded", entityType: "AccountActivity", entityId: saved.id, metadata: { accountCode: account.accountCode, activityCode: saved.activityCode, type: saved.type, sourcingRequestId: saved.sourcingRequestId } } }); return saved; });
    if (!activity) return apiError("ACCOUNT_NOT_FOUND", "The account was not found in your assigned portfolio.", 404);
    return apiSuccess({ activity }, { status: 201, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    if (error instanceof Error && error.message === "RFQ_ACCOUNT_MISMATCH") return apiError("RFQ_ACCOUNT_MISMATCH", "The sourcing request does not belong to this business account.", 409);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") { const existing = await prisma.accountActivity.findUnique({ where: { idempotencyKey } }); if (existing?.accountId === accountId && existing.authorId === session.userId) return apiSuccess({ activity: existing }, { headers: { "Cache-Control": "private, no-store, max-age=0" } }); return apiError("IDEMPOTENCY_KEY_REUSED", "This idempotency key was already used for another activity.", 409); }
    throw error;
  }
}
