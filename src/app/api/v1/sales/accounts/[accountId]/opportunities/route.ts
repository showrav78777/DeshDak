import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { opportunityCreateSchema } from "@/modules/sales/schemas";

const keyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const select = { id: true, opportunityCode: true, accountId: true, ownerId: true, sourcingRequestId: true, title: true, stage: true, estimatedValue: true, currency: true, expectedCloseAt: true, note: true, version: true, createdAt: true, updatedAt: true, requestFingerprint: true, sourcingRequest: { select: { reference: true, productTitle: true, status: true } }, owner: { select: { personCode: true, fullName: true } }, stageChanges: { select: { fromStage: true, toStage: true, note: true, createdAt: true, actor: { select: { personCode: true, fullName: true } } }, orderBy: { createdAt: "desc" as const } } } satisfies Prisma.SalesOpportunitySelect;
const safe = <T extends { requestFingerprint: string }>(value: T) => { const { requestFingerprint, ...result } = value; void requestFingerprint; return result; };

export async function GET(request: NextRequest, context: { params: Promise<{ accountId: string }> }) {
  const session = await getRequestSession(request); if (!session?.roles.includes(ROLE.KAM) || session.portal !== "sales") return apiError("KAM_ACCESS_REQUIRED", "Key Account Manager access is required.", 403);
  const { accountId } = await context.params;
  const account = await prisma.businessAccount.findFirst({ where: { id: accountId, status: "ACTIVE", assignments: { some: { userId: session.userId, isActive: true } } }, select: { id: true } });
  if (!account) return apiError("ACCOUNT_NOT_FOUND", "The account was not found in your assigned portfolio.", 404);
  const opportunities = await prisma.salesOpportunity.findMany({ where: { accountId }, select, orderBy: { updatedAt: "desc" }, take: 200 });
  return apiSuccess({ opportunities: opportunities.map(safe) }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function POST(request: NextRequest, context: { params: Promise<{ accountId: string }> }) {
  const session = await getRequestSession(request); if (!session?.roles.includes(ROLE.KAM) || session.portal !== "sales") return apiError("KAM_ACCESS_REQUIRED", "Key Account Manager access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "Opportunity creation must originate from the Sales application.", 403);
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim(); if (!idempotencyKey || !keyPattern.test(idempotencyKey)) return apiError("IDEMPOTENCY_KEY_REQUIRED", "A valid UUID Idempotency-Key header is required.", 400);
  const parsed = opportunityCreateSchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return apiError("VALIDATION_ERROR", "Check the opportunity details.", 422, { fields: parsed.error.flatten().fieldErrors });
  const { accountId } = await context.params;
  const payload = { accountId, ownerId: session.userId, ...parsed.data, estimatedValue: parsed.data.estimatedValue?.toFixed(2) ?? null, currency: parsed.data.currency ?? null, expectedCloseAt: parsed.data.expectedCloseAt?.toISOString() ?? null, note: parsed.data.note ?? null };
  const requestFingerprint = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const replay = await prisma.salesOpportunity.findUnique({ where: { idempotencyKey }, select });
  if (replay) return replay.accountId === accountId && replay.ownerId === session.userId && replay.requestFingerprint === requestFingerprint ? apiSuccess({ opportunity: safe(replay), idempotentReplay: true }, { headers: { "Cache-Control": "private, no-store, max-age=0" } }) : apiError("IDEMPOTENCY_KEY_REUSED", "This idempotency key was already used for another opportunity.", 409);
  try {
    const opportunity = await prisma.$transaction(async (tx) => {
      const account = await tx.businessAccount.findFirst({ where: { id: accountId, status: "ACTIVE", assignments: { some: { userId: session.userId, isActive: true } } }, select: { id: true, ownerId: true, accountCode: true } });
      if (!account) throw new Error("ACCOUNT_NOT_FOUND");
      if (parsed.data.sourcingRequestId && !(await tx.sourcingRequest.findFirst({ where: { id: parsed.data.sourcingRequestId, customerId: account.ownerId }, select: { id: true } }))) throw new Error("RFQ_ACCOUNT_MISMATCH");
      const created = await tx.salesOpportunity.create({ data: { accountId, ownerId: session.userId, idempotencyKey, requestFingerprint, ...parsed.data }, select });
      await tx.opportunityStageChange.create({ data: { opportunityId: created.id, toStage: "DISCOVERY", actorId: session.userId, note: "Opportunity created.", idempotencyKey, requestFingerprint } });
      await tx.auditLog.create({ data: { actorId: session.userId, action: "sales.opportunity_created", entityType: "SalesOpportunity", entityId: created.id, metadata: { opportunityCode: created.opportunityCode, accountCode: account.accountCode, sourcingRequestId: created.sourcingRequestId } } });
      return created;
    });
    return apiSuccess({ opportunity: safe(opportunity), idempotentReplay: false }, { status: 201, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    if (error instanceof Error && error.message === "ACCOUNT_NOT_FOUND") return apiError("ACCOUNT_NOT_FOUND", "The account was not found in your assigned portfolio.", 404);
    if (error instanceof Error && error.message === "RFQ_ACCOUNT_MISMATCH") return apiError("RFQ_ACCOUNT_MISMATCH", "The sourcing request does not belong to this Business account.", 409);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") { const raced = await prisma.salesOpportunity.findUnique({ where: { idempotencyKey }, select }); if (raced && raced.accountId === accountId && raced.ownerId === session.userId && raced.requestFingerprint === requestFingerprint) return apiSuccess({ opportunity: safe(raced), idempotentReplay: true }, { headers: { "Cache-Control": "private, no-store, max-age=0" } }); return apiError(parsed.data.sourcingRequestId ? "RFQ_ALREADY_LINKED" : "IDEMPOTENCY_KEY_REUSED", parsed.data.sourcingRequestId ? "This sourcing request is already linked to an opportunity." : "This idempotency key is already in use.", 409); }
    throw error;
  }
}
