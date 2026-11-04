import { createHash } from "node:crypto";
import { Prisma, type PaymentSettlementMatchStatus, type PaymentSettlementResolutionDecisionType, type PaymentSettlementResolutionType } from "@prisma/client";
import { createReference } from "../../lib/reference.ts";

type SettlementRow = {
  externalTransactionId: string;
  bankTransactionId?: string | null;
  grossAmount: Prisma.Decimal;
  gatewayFee: Prisma.Decimal;
  netAmount: Prisma.Decimal;
  currency: string;
  settledAt: Date;
};

export class SettlementImportError extends Error {
  readonly code: "IDEMPOTENCY_CONFLICT" | "BATCH_REFERENCE_CONFLICT";
  constructor(code: "IDEMPOTENCY_CONFLICT" | "BATCH_REFERENCE_CONFLICT", message: string) {
    super(message);
    this.code = code;
    this.name = "SettlementImportError";
  }
}

export class SettlementResolutionError extends Error {
  readonly code: "NOT_FOUND" | "NOT_RESOLVABLE" | "PENDING_PROPOSAL" | "INVALID_CORRECTED_PAYMENT" | "IDEMPOTENCY_CONFLICT" | "INDEPENDENT_REVIEW_REQUIRED" | "ALREADY_REVIEWED" | "ALREADY_RESOLVED" | "CHARGEBACK_NOT_POSTABLE";
  constructor(code: "NOT_FOUND" | "NOT_RESOLVABLE" | "PENDING_PROPOSAL" | "INVALID_CORRECTED_PAYMENT" | "IDEMPOTENCY_CONFLICT" | "INDEPENDENT_REVIEW_REQUIRED" | "ALREADY_REVIEWED" | "ALREADY_RESOLVED" | "CHARGEBACK_NOT_POSTABLE", message: string) {
    super(message);
    this.code = code;
    this.name = "SettlementResolutionError";
  }
}

function gatewayRequiresReview(payload: Prisma.JsonValue | null) {
  return Boolean(payload && typeof payload === "object" && !Array.isArray(payload) && (payload.reviewRequired === true || payload.financialResolutionRequired === true));
}

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function proposeSettlementResolution(tx: Prisma.TransactionClient, input: { settlementEntryId: string; resolutionType: PaymentSettlementResolutionType; reason: string; evidenceReference: string; correctedPaymentReference?: string | null; proposedById: string; idempotencyKey: string }) {
  const normalized = { settlementEntryId: input.settlementEntryId, resolutionType: input.resolutionType, reason: input.reason.trim(), evidenceReference: input.evidenceReference.trim(), correctedPaymentReference: input.correctedPaymentReference?.trim() || null };
  const requestFingerprint = hash(normalized);
  const replay = await tx.paymentSettlementResolutionProposal.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { decision: true } });
  if (replay) {
    if (replay.proposedById !== input.proposedById || replay.requestFingerprint !== requestFingerprint) throw new SettlementResolutionError("IDEMPOTENCY_CONFLICT", "This request key was already used for another proposal.");
    return { proposal: replay, replay: true };
  }
  await tx.$queryRaw`SELECT "id" FROM "PaymentSettlementEntry" WHERE "id" = ${input.settlementEntryId} FOR UPDATE`;
  const entry = await tx.paymentSettlementEntry.findUnique({ where: { id: input.settlementEntryId }, include: { batch: { select: { provider: true } }, resolutionProposals: { include: { decision: true }, orderBy: { proposedAt: "desc" } } } });
  if (!entry) throw new SettlementResolutionError("NOT_FOUND", "Settlement exception was not found.");
  if (entry.matchStatus === "MATCHED") throw new SettlementResolutionError("NOT_RESOLVABLE", "An exact settlement match does not require manual resolution.");
  if (entry.resolutionProposals.some((proposal) => proposal.decision?.decision === "APPROVED")) throw new SettlementResolutionError("ALREADY_RESOLVED", "This settlement exception already has an approved resolution.");
  if (entry.resolutionProposals.some((proposal) => !proposal.decision)) throw new SettlementResolutionError("PENDING_PROPOSAL", "This settlement exception already has a proposal waiting for independent review.");
  if (normalized.resolutionType === "PAYMENT_REFERENCE_CORRECTED") {
    if (!normalized.correctedPaymentReference) throw new SettlementResolutionError("INVALID_CORRECTED_PAYMENT", "Enter the corrected DeshDak payment reference.");
    const payment = await tx.paymentIntent.findUnique({ where: { reference: normalized.correctedPaymentReference } });
    const alreadyMatched = await tx.paymentSettlementEntry.findFirst({ where: { externalTransactionId: normalized.correctedPaymentReference, batch: { provider: entry.batch.provider }, matchStatus: "MATCHED" }, select: { id: true } });
    if (!payment || payment.provider !== entry.batch.provider || payment.status !== "SUCCEEDED" || payment.currency !== entry.currency || !payment.amount.equals(entry.grossAmount) || gatewayRequiresReview(payment.gatewayPayload) || alreadyMatched) throw new SettlementResolutionError("INVALID_CORRECTED_PAYMENT", "The corrected reference must identify one unresolved, exact successful payment for the same provider, currency, and gross amount.");
  } else if (normalized.correctedPaymentReference) throw new SettlementResolutionError("INVALID_CORRECTED_PAYMENT", "A corrected payment reference is allowed only for PAYMENT_REFERENCE_CORRECTED.");
  const proposal = await tx.paymentSettlementResolutionProposal.create({ data: { ...normalized, proposedById: input.proposedById, idempotencyKey: input.idempotencyKey, requestFingerprint }, include: { decision: true } });
  await tx.auditLog.create({ data: { actorId: input.proposedById, action: "payment.settlement_resolution_proposed", entityType: "PaymentSettlementEntry", entityId: entry.id, metadata: { proposalId: proposal.id, resolutionType: proposal.resolutionType, evidenceReference: proposal.evidenceReference, correctedPaymentReference: proposal.correctedPaymentReference, reason: proposal.reason } } });
  return { proposal, replay: false };
}

export async function decideSettlementResolution(tx: Prisma.TransactionClient, input: { proposalId: string; decision: PaymentSettlementResolutionDecisionType; reason: string; reviewedById: string; idempotencyKey: string }) {
  const normalized = { proposalId: input.proposalId, decision: input.decision, reason: input.reason.trim() };
  const requestFingerprint = hash(normalized);
  const replay = await tx.paymentSettlementResolutionDecision.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (replay) {
    if (replay.reviewedById !== input.reviewedById || replay.requestFingerprint !== requestFingerprint) throw new SettlementResolutionError("IDEMPOTENCY_CONFLICT", "This request key was already used for another review decision.");
    return { resolutionDecision: replay, replay: true };
  }
  const proposal = await tx.paymentSettlementResolutionProposal.findUnique({ where: { id: input.proposalId }, include: { decision: true, settlementEntry: { include: { batch: { select: { provider: true } }, paymentIntent: { include: { refunds: { where: { status: { in: ["PENDING_APPROVAL", "APPROVED", "PROCESSING", "SUCCEEDED"] } }, select: { id: true } } } }, resolutionDecisions: { where: { decision: "APPROVED" }, select: { id: true } } } } } });
  if (!proposal) throw new SettlementResolutionError("NOT_FOUND", "Resolution proposal was not found.");
  if (proposal.proposedById === input.reviewedById) throw new SettlementResolutionError("INDEPENDENT_REVIEW_REQUIRED", "The person who proposed a resolution cannot approve or reject it.");
  if (proposal.decision) throw new SettlementResolutionError("ALREADY_REVIEWED", "This proposal already has a final review decision.");
  if (proposal.settlementEntry.resolutionDecisions.length) throw new SettlementResolutionError("ALREADY_RESOLVED", "This settlement exception already has an approved resolution.");
  const isApprovedChargeback = input.decision === "APPROVED" && proposal.resolutionType === "CHARGEBACK_CONFIRMED";
  if (isApprovedChargeback) {
    const entry = proposal.settlementEntry; const payment = entry.paymentIntent;
    if (entry.matchStatus !== "DUPLICATE_TRANSACTION" || !payment || payment.provider !== entry.batch.provider || payment.status !== "SUCCEEDED" || payment.currency !== entry.currency || !payment.amount.equals(entry.grossAmount) || payment.refunds.length) throw new SettlementResolutionError("CHARGEBACK_NOT_POSTABLE", "A chargeback requires an exact duplicated provider row linked to a successful payment with no active or completed refund.");
  }
  const resolutionDecision = await tx.paymentSettlementResolutionDecision.create({ data: { proposalId: proposal.id, settlementEntryId: proposal.settlementEntryId, decision: input.decision, reason: normalized.reason, reviewedById: input.reviewedById, idempotencyKey: input.idempotencyKey, requestFingerprint } });
  if (isApprovedChargeback) await tx.financialJournal.create({ data: { reference: createReference("JRN"), eventType: "CHARGEBACK_CONFIRMED", eventId: proposal.id, currency: proposal.settlementEntry.currency, description: `Confirmed chargeback ${proposal.evidenceReference}`, entries: { create: [{ accountCode: "CHARGEBACK_LOSS", direction: "DEBIT", amount: proposal.settlementEntry.grossAmount, currency: proposal.settlementEntry.currency, memo: proposal.reason }, { accountCode: "PAYMENT_GATEWAY_CLEARING", direction: "CREDIT", amount: proposal.settlementEntry.grossAmount, currency: proposal.settlementEntry.currency, memo: proposal.reason }] } } });
  await tx.auditLog.create({ data: { actorId: input.reviewedById, action: input.decision === "APPROVED" ? "payment.settlement_resolution_approved" : "payment.settlement_resolution_rejected", entityType: "PaymentSettlementEntry", entityId: proposal.settlementEntryId, metadata: { proposalId: proposal.id, resolutionDecisionId: resolutionDecision.id, resolutionType: proposal.resolutionType, decision: input.decision, reason: normalized.reason, noCustomerMutation: true, journalPosted: isApprovedChargeback } } });
  return { resolutionDecision, replay: false };
}

export function settlementSourceFingerprint(input: { provider: string; externalBatchReference: string; settlementDate: Date; currency: string; entries: SettlementRow[] }) {
  return hash({ provider: input.provider, externalBatchReference: input.externalBatchReference, settlementDate: input.settlementDate.toISOString(), currency: input.currency, entries: input.entries.map((row) => ({ ...row, grossAmount: row.grossAmount.toFixed(2), gatewayFee: row.gatewayFee.toFixed(2), netAmount: row.netAmount.toFixed(2), settledAt: row.settledAt.toISOString() })) });
}

export async function importPaymentSettlement(tx: Prisma.TransactionClient, input: { provider: string; externalBatchReference: string; settlementDate: Date; currency: string; entries: SettlementRow[]; importedById: string; idempotencyKey: string; sourceFingerprint: string; reference: string }) {
  const replay = await tx.paymentSettlementBatch.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { entries: { orderBy: { rowNumber: "asc" } } } });
  if (replay) {
    if (replay.sourceFingerprint !== input.sourceFingerprint || replay.importedById !== input.importedById) throw new SettlementImportError("IDEMPOTENCY_CONFLICT", "This request key was already used for different settlement evidence.");
    return { batch: replay, replay: true };
  }
  const sameBatch = await tx.paymentSettlementBatch.findUnique({ where: { provider_externalBatchReference: { provider: input.provider, externalBatchReference: input.externalBatchReference } }, select: { sourceFingerprint: true } });
  if (sameBatch) throw new SettlementImportError("BATCH_REFERENCE_CONFLICT", sameBatch.sourceFingerprint === input.sourceFingerprint ? "This settlement report was already imported with another request key." : "This provider batch reference already contains different evidence.");

  const transactionIds = [...new Set(input.entries.map((row) => row.externalTransactionId))];
  const payments = await tx.paymentIntent.findMany({ where: { provider: input.provider, reference: { in: transactionIds } } });
  const paymentByReference = new Map(payments.map((payment) => [payment.reference, payment]));
  const previouslyMatched = new Set((await tx.paymentSettlementEntry.findMany({ where: { externalTransactionId: { in: transactionIds }, batch: { provider: input.provider }, matchStatus: "MATCHED" }, select: { externalTransactionId: true } })).map((entry) => entry.externalTransactionId));
  const seen = new Set<string>();
  const resolved = input.entries.map((row, index) => {
    const payment = paymentByReference.get(row.externalTransactionId);
    let matchStatus: PaymentSettlementMatchStatus = "MATCHED";
    let exceptionReason: string | null = null;
    if (seen.has(row.externalTransactionId) || previouslyMatched.has(row.externalTransactionId)) {
      matchStatus = "DUPLICATE_TRANSACTION"; exceptionReason = "The transaction is duplicated in this report or was matched in an earlier settlement.";
    } else if (!payment) {
      matchStatus = "PAYMENT_NOT_FOUND"; exceptionReason = "No payment uses this DeshDak transaction reference.";
    } else if (gatewayRequiresReview(payment.gatewayPayload)) {
      matchStatus = "REVIEW_REQUIRED"; exceptionReason = "The payment has an unresolved provider risk or financial review.";
    } else if (payment.status !== "SUCCEEDED") {
      matchStatus = "PAYMENT_NOT_SUCCEEDED"; exceptionReason = `The local payment status is ${payment.status}, not SUCCEEDED.`;
    } else if (payment.currency !== row.currency) {
      matchStatus = "CURRENCY_MISMATCH"; exceptionReason = `Expected ${payment.currency}, received ${row.currency}.`;
    } else if (!payment.amount.equals(row.grossAmount)) {
      matchStatus = "AMOUNT_MISMATCH"; exceptionReason = `Expected ${payment.amount.toFixed(2)}, received ${row.grossAmount.toFixed(2)}.`;
    }
    seen.add(row.externalTransactionId);
    return { row, rowNumber: index + 1, paymentIntentId: payment?.id ?? null, matchStatus, exceptionReason, evidenceFingerprint: hash({ transaction: row.externalTransactionId, bank: row.bankTransactionId ?? null, gross: row.grossAmount.toFixed(2), fee: row.gatewayFee.toFixed(2), net: row.netAmount.toFixed(2), currency: row.currency, settledAt: row.settledAt.toISOString() }) };
  });
  const matchedCount = resolved.filter((row) => row.matchStatus === "MATCHED").length;
  const batch = await tx.paymentSettlementBatch.create({ data: {
    reference: input.reference, provider: input.provider, externalBatchReference: input.externalBatchReference, settlementDate: input.settlementDate, currency: input.currency,
    status: matchedCount === resolved.length ? "RECONCILED" : "EXCEPTIONS", sourceFingerprint: input.sourceFingerprint, idempotencyKey: input.idempotencyKey,
    importedById: input.importedById, rowCount: resolved.length, matchedCount, exceptionCount: resolved.length - matchedCount,
    entries: { create: resolved.map(({ row, ...entry }) => ({ ...entry, externalTransactionId: row.externalTransactionId, bankTransactionId: row.bankTransactionId, grossAmount: row.grossAmount, gatewayFee: row.gatewayFee, netAmount: row.netAmount, currency: row.currency, settledAt: row.settledAt })) },
  }, include: { entries: { orderBy: { rowNumber: "asc" } } } });
  await tx.auditLog.create({ data: { actorId: input.importedById, action: "payment.settlement_imported", entityType: "PaymentSettlementBatch", entityId: batch.id, metadata: { reference: batch.reference, provider: batch.provider, externalBatchReference: batch.externalBatchReference, settlementDate: batch.settlementDate.toISOString(), currency: batch.currency, rowCount: batch.rowCount, matchedCount: batch.matchedCount, exceptionCount: batch.exceptionCount, sourceFingerprint: batch.sourceFingerprint } } });
  return { batch, replay: false };
}
