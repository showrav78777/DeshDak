import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { opportunityStageSchema } from "@/modules/sales/schemas";

const keyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const terminal = new Set(["WON", "LOST"]);

export async function PATCH(request: NextRequest, context: { params: Promise<{ opportunityId: string }> }) {
  const session = await getRequestSession(request); if (!session?.roles.includes(ROLE.KAM) || session.portal !== "sales") return apiError("KAM_ACCESS_REQUIRED", "Key Account Manager access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "Opportunity changes must originate from the Sales application.", 403);
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim(); if (!idempotencyKey || !keyPattern.test(idempotencyKey)) return apiError("IDEMPOTENCY_KEY_REQUIRED", "A valid UUID Idempotency-Key header is required.", 400);
  const parsed = opportunityStageSchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return apiError("VALIDATION_ERROR", "Check the stage, version, and note.", 422, { fields: parsed.error.flatten().fieldErrors });
  const { opportunityId } = await context.params;
  const requestFingerprint = createHash("sha256").update(JSON.stringify({ opportunityId, actorId: session.userId, ...parsed.data })).digest("hex");
  const replay = await prisma.opportunityStageChange.findUnique({ where: { idempotencyKey }, select: { opportunityId: true, requestFingerprint: true } });
  if (replay) { if (replay.opportunityId !== opportunityId || replay.requestFingerprint !== requestFingerprint) return apiError("IDEMPOTENCY_KEY_REUSED", "This idempotency key was already used for another stage change.", 409); const value = await prisma.salesOpportunity.findUnique({ where: { id: opportunityId }, select: { id: true, opportunityCode: true, stage: true, version: true, updatedAt: true } }); return apiSuccess({ opportunity: value, idempotentReplay: true }, { headers: { "Cache-Control": "private, no-store, max-age=0" } }); }
  try {
    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.salesOpportunity.findFirst({ where: { id: opportunityId, account: { status: "ACTIVE", assignments: { some: { userId: session.userId, isActive: true } } } }, select: { id: true, opportunityCode: true, stage: true, version: true, sourcingRequest: { select: { order: { select: { id: true, orderNumber: true } } } }, account: { select: { accountCode: true } } } });
      if (!current) return { code: "NOT_FOUND" as const };
      if (current.version !== parsed.data.version) return { code: "VERSION_CONFLICT" as const };
      if (current.stage === parsed.data.stage) return { code: "SAME_STAGE" as const };
      if (terminal.has(current.stage)) return { code: "TERMINAL" as const };
      if (parsed.data.stage === "WON" && !current.sourcingRequest?.order) return { code: "ORDER_REQUIRED" as const };
      const changed = await tx.salesOpportunity.updateMany({ where: { id: current.id, version: current.version, stage: current.stage }, data: { stage: parsed.data.stage, version: { increment: 1 } } });
      if (changed.count !== 1) return { code: "VERSION_CONFLICT" as const };
      await tx.opportunityStageChange.create({ data: { opportunityId, fromStage: current.stage, toStage: parsed.data.stage, actorId: session.userId, note: parsed.data.note, idempotencyKey, requestFingerprint } });
      await tx.auditLog.create({ data: { actorId: session.userId, action: "sales.opportunity_stage_changed", entityType: "SalesOpportunity", entityId: opportunityId, metadata: { opportunityCode: current.opportunityCode, accountCode: current.account.accountCode, fromStage: current.stage, toStage: parsed.data.stage, orderNumber: current.sourcingRequest?.order?.orderNumber } } });
      return { value: await tx.salesOpportunity.findUniqueOrThrow({ where: { id: opportunityId }, select: { id: true, opportunityCode: true, stage: true, version: true, updatedAt: true } }) };
    });
    if ("code" in result) {
      if (result.code === "NOT_FOUND") return apiError("OPPORTUNITY_NOT_FOUND", "The opportunity was not found in your assigned portfolio.", 404);
      if (result.code === "VERSION_CONFLICT") return apiError("OPPORTUNITY_VERSION_CONFLICT", "This opportunity changed in another session. Refresh and try again.", 409);
      if (result.code === "SAME_STAGE") return apiError("OPPORTUNITY_STAGE_UNCHANGED", "Choose a different pipeline stage.", 409);
      if (result.code === "TERMINAL") return apiError("OPPORTUNITY_TERMINAL", "Won or lost opportunities cannot be changed by a KAM.", 409);
      return apiError("OPPORTUNITY_ORDER_REQUIRED", "A linked sourcing request must convert to an order before the opportunity can be marked won.", 409);
    }
    return apiSuccess({ opportunity: result.value, idempotentReplay: false }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return apiError("IDEMPOTENCY_KEY_REUSED", "This idempotency key is already in use.", 409);
    throw error;
  }
}
