import { Prisma, type ExchangeRate } from "@prisma/client";
import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("APPROVE"), financeApproved: z.boolean(), complianceApproved: z.boolean() }),
  z.object({ action: z.literal("FINANCE_APPROVE") }),
  z.object({ action: z.literal("ACTIVATE") }),
  z.object({ action: z.literal("REVOKE") }),
]);

class RateStateError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ rateId: string }> }) {
  const session = await getRequestSession(request);
  if (!session || (!session.roles.includes(ROLE.ADMIN) && !session.roles.includes(ROLE.FINANCE))) return apiError("FINANCE_ACCESS_REQUIRED", "Finance access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "This financial action must originate from a protected application.", 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Choose a valid rate workflow action.", 422);
  const { rateId } = await context.params;
  try {
    const rate = await prisma.$transaction(async (tx) => {
      const current = await tx.exchangeRate.findUnique({ where: { id: rateId } });
      if (!current) throw new RateStateError("EXCHANGE_RATE_NOT_FOUND", "Exchange-rate version was not found.");
      let saved: ExchangeRate;
      if (parsed.data.action === "APPROVE" || parsed.data.action === "FINANCE_APPROVE") {
        if (current.status !== "DRAFT") throw new RateStateError("EXCHANGE_RATE_IMMUTABLE", "Approval flags cannot be changed after activation. Create a new version instead.");
        if (parsed.data.action === "APPROVE" && !session.roles.includes(ROLE.ADMIN)) throw new RateStateError("SEGREGATION_OF_DUTIES_REQUIRED", "Finance cannot record Compliance approval.");
        saved = await tx.exchangeRate.update({ where: { id: rateId }, data: parsed.data.action === "FINANCE_APPROVE" ? { financeApproved: true } : { financeApproved: parsed.data.financeApproved, complianceApproved: parsed.data.complianceApproved } });
      } else if (parsed.data.action === "ACTIVATE") {
        const now = new Date();
        if (current.status !== "DRAFT") throw new RateStateError("EXCHANGE_RATE_NOT_DRAFT", "Only a draft rate can be activated.");
        if (!current.financeApproved || !current.complianceApproved) throw new RateStateError("EXCHANGE_RATE_APPROVAL_REQUIRED", "Finance and Compliance approval are required before activation.");
        if (current.validFrom > now || (current.validTo && current.validTo <= now)) throw new RateStateError("EXCHANGE_RATE_WINDOW_INVALID", "The rate must be inside its approved validity window before activation.");
        await tx.exchangeRate.updateMany({ where: { id: { not: current.id }, baseCurrency: current.baseCurrency, quoteCurrency: current.quoteCurrency, customerSegment: current.customerSegment, status: "ACTIVE" }, data: { status: "REVOKED", revokedAt: now, validTo: now } });
        saved = await tx.exchangeRate.update({ where: { id: rateId }, data: { status: "ACTIVE", activatedAt: now } });
      } else {
        if (current.status !== "ACTIVE") throw new RateStateError("EXCHANGE_RATE_NOT_ACTIVE", "Only an active rate can be revoked.");
        const now = new Date();
        saved = await tx.exchangeRate.update({ where: { id: rateId }, data: { status: "REVOKED", revokedAt: now, validTo: now } });
      }
      await tx.auditLog.create({ data: { actorId: session.userId, action: `exchange_rate.${parsed.data.action.toLowerCase()}`, entityType: "ExchangeRate", entityId: saved.id, metadata: { pair: `${saved.baseCurrency}_${saved.quoteCurrency}`, customerSegment: saved.customerSegment, status: saved.status, financeApproved: saved.financeApproved, complianceApproved: saved.complianceApproved } } });
      return saved;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return apiSuccess({ rate }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    if (error instanceof RateStateError) return apiError(error.code, error.message, error.code === "EXCHANGE_RATE_NOT_FOUND" ? 404 : 409);
    throw error;
  }
}
