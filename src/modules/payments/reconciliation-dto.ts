type NamedUser = { fullName: string };
type ResolutionDecisionRecord = { id: string; decision: string; reason: string; reviewedAt: Date; reviewedBy?: NamedUser };
type ResolutionProposalRecord = { id: string; settlementEntryId: string; resolutionType: string; reason: string; evidenceReference: string; correctedPaymentReference: string | null; proposedAt: Date; proposedBy?: NamedUser; decision?: ResolutionDecisionRecord | null };
type SettlementEntryRecord = { id: string; rowNumber: number; externalTransactionId: string; bankTransactionId: string | null; grossAmount: unknown; gatewayFee: unknown; netAmount: unknown; currency: string; settledAt: Date; matchStatus: string; exceptionReason: string | null; resolutionProposals?: ResolutionProposalRecord[] };
type SettlementBatchRecord = { id: string; reference: string; provider: string; externalBatchReference: string; settlementDate: Date; currency: string; status: string; rowCount: number; matchedCount: number; exceptionCount: number; importedAt: Date; importedBy?: NamedUser; entries?: SettlementEntryRecord[] };

export function reconciliationDecisionDto(decision: ResolutionDecisionRecord) {
  return { id: decision.id, decision: decision.decision, reason: decision.reason, reviewedAt: decision.reviewedAt, ...(decision.reviewedBy ? { reviewedBy: decision.reviewedBy } : {}) };
}

export function reconciliationProposalDto(proposal: ResolutionProposalRecord) {
  return { id: proposal.id, settlementEntryId: proposal.settlementEntryId, resolutionType: proposal.resolutionType, reason: proposal.reason, evidenceReference: proposal.evidenceReference, correctedPaymentReference: proposal.correctedPaymentReference, proposedAt: proposal.proposedAt, ...(proposal.proposedBy ? { proposedBy: proposal.proposedBy } : {}), ...(proposal.decision !== undefined ? { decision: proposal.decision ? reconciliationDecisionDto(proposal.decision) : null } : {}) };
}

export function reconciliationBatchDto(batch: SettlementBatchRecord) {
  return { id: batch.id, reference: batch.reference, provider: batch.provider, externalBatchReference: batch.externalBatchReference, settlementDate: batch.settlementDate, currency: batch.currency, status: batch.status, rowCount: batch.rowCount, matchedCount: batch.matchedCount, exceptionCount: batch.exceptionCount, importedAt: batch.importedAt, ...(batch.importedBy ? { importedBy: batch.importedBy } : {}), ...(batch.entries ? { entries: batch.entries.map((entry) => ({ id: entry.id, rowNumber: entry.rowNumber, externalTransactionId: entry.externalTransactionId, bankTransactionId: entry.bankTransactionId, grossAmount: entry.grossAmount, gatewayFee: entry.gatewayFee, netAmount: entry.netAmount, currency: entry.currency, settledAt: entry.settledAt, matchStatus: entry.matchStatus, exceptionReason: entry.exceptionReason, ...(entry.resolutionProposals ? { resolutionProposals: entry.resolutionProposals.map(reconciliationProposalDto) } : {}) })) } : {}) };
}
