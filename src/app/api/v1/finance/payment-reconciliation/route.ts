import { Prisma } from "@prisma/client";
import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { createReference } from "@/lib/reference";
import { ROLE } from "@/lib/roles";
import { importPaymentSettlement, settlementSourceFingerprint, SettlementImportError } from "@/modules/payments/reconciliation";
import { reconciliationBatchDto } from "@/modules/payments/reconciliation-dto";

const money = z.coerce.number().finite().min(0).max(100_000_000);
const row = z.object({ externalTransactionId: z.string().trim().min(3).max(100), bankTransactionId: z.string().trim().max(100).optional(), grossAmount: money, gatewayFee: money.default(0), netAmount: money, currency: z.string().trim().length(3), settledAt: z.coerce.date() });
const schema = z.object({ provider: z.literal("SSLCOMMERZ"), externalBatchReference: z.string().trim().min(3).max(100), settlementDate: z.coerce.date(), currency: z.string().trim().length(3), entries: z.array(row).min(1).max(1000) });

function hasFinanceAccess(session: Awaited<ReturnType<typeof getRequestSession>>) {
  return Boolean(session && ((session.portal === "finance" && session.roles.includes(ROLE.FINANCE)) || (session.portal === "admin" && session.roles.includes(ROLE.ADMIN))));
}

export async function GET(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!hasFinanceAccess(session)) return apiError("FINANCE_ACCESS_REQUIRED", "MFA-verified Finance or Admin access is required.", 403);
  const batches = await prisma.paymentSettlementBatch.findMany({ include: { importedBy: { select: { fullName: true } }, entries: { where: { matchStatus: { not: "MATCHED" } }, include: { resolutionProposals: { include: { proposedBy: { select: { fullName: true } }, decision: { include: { reviewedBy: { select: { fullName: true } } } } }, orderBy: { proposedAt: "desc" } } }, orderBy: { rowNumber: "asc" }, take: 100 } }, orderBy: { importedAt: "desc" }, take: 100 });
  return apiSuccess({ batches: batches.map(reconciliationBatchDto) }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function POST(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!hasFinanceAccess(session)) return apiError("FINANCE_ACCESS_REQUIRED", "MFA-verified Finance or Admin access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "Settlement evidence must originate from the protected application.", 403);
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
  if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 200) return apiError("IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required.", 400);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Check the settlement report fields and rows.", 422, z.treeifyError(parsed.error));
  const currency = parsed.data.currency.toUpperCase();
  const entries = parsed.data.entries.map((entry) => ({ ...entry, externalTransactionId: entry.externalTransactionId.trim(), bankTransactionId: entry.bankTransactionId?.trim() || null, grossAmount: new Prisma.Decimal(entry.grossAmount), gatewayFee: new Prisma.Decimal(entry.gatewayFee), netAmount: new Prisma.Decimal(entry.netAmount), currency: entry.currency.toUpperCase() }));
  if (entries.some((entry) => entry.currency !== currency || !entry.grossAmount.minus(entry.gatewayFee).equals(entry.netAmount))) return apiError("SETTLEMENT_TOTAL_INVALID", "Every row must use the batch currency and net amount must equal gross amount minus gateway fee.", 422);
  const sourceFingerprint = settlementSourceFingerprint({ ...parsed.data, currency, entries });
  try {
    const result = await prisma.$transaction((tx) => importPaymentSettlement(tx, { ...parsed.data, currency, entries, importedById: session!.userId, idempotencyKey, sourceFingerprint, reference: createReference("STL") }), { isolationLevel: "Serializable" });
    return apiSuccess({ batch: reconciliationBatchDto(result.batch), idempotentReplay: result.replay }, { status: result.replay ? 200 : 201, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    if (error instanceof SettlementImportError) return apiError(error.code === "IDEMPOTENCY_CONFLICT" ? "IDEMPOTENCY_KEY_REUSED" : "SETTLEMENT_BATCH_EXISTS", error.message, 409);
    if ((error as { code?: string }).code === "P2034") return apiError("SETTLEMENT_RETRY_REQUIRED", "Concurrent financial evidence changed. Review the queue and retry with a new request key.", 409);
    if ((error as { code?: string }).code === "P2002") return apiError("SETTLEMENT_EVIDENCE_EXISTS", "This report reference or evidence was imported concurrently. Review the reconciliation queue before retrying.", 409);
    throw error;
  }
}
