import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";

const prisma = new PrismaClient();
const origin = new URL(process.env.TEST_BASE_URL ?? process.env.APP_BASE_URL ?? "http://localhost:3000").origin;
const marker = randomBytes(8).toString("hex");
const secret = process.env.AUTH_SECRET;
if (!secret) throw new Error("AUTH_SECRET is required for reconciliation-resolution verification.");
const ids = { users: [], sessions: [], batches: [], entries: [], proposals: [], decisions: [] };
function assert(value, message) { if (!value) throw new Error(message); }
async function financeIdentity(role, suffix) {
  const user = await prisma.user.create({ data: { email: `resolution-${suffix}-${marker}@example.test`, fullName: `Resolution ${suffix}`, passwordHash: "not-used", status: "ACTIVE", roles: { create: { roleId: role.id } } } }); ids.users.push(user.id);
  const session = await prisma.authSession.create({ data: { userId: user.id, portal: "finance", clientName: "Resolution verification", clientType: "WEB", mfaVerifiedAt: new Date(), expiresAt: new Date(Date.now() + 60 * 60_000) } }); ids.sessions.push(session.id);
  const token = await new SignJWT({ email: user.email, name: user.fullName, roles: ["finance"] }).setProtectedHeader({ alg: "HS256" }).setJti(session.id).setSubject(user.id).setIssuer(process.env.AUTH_ISSUER ?? "http://localhost:3000").setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(secret));
  return { user, cookie: `crossly_session=${token}; __Host-crossly_session=${token}` };
}
async function post(path, cookie, key, body, includeOrigin = true) {
  const response = await fetch(`${origin}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie, "Idempotency-Key": key, ...(includeOrigin ? { Origin: origin } : {}) }, body: JSON.stringify(body) });
  return { response, body: await response.json() };
}

try {
  const role = await prisma.role.upsert({ where: { code: "finance" }, update: {}, create: { code: "finance", description: "Finance operator" } });
  const maker = await financeIdentity(role, "Maker");
  const checker = await financeIdentity(role, "Checker");
  const batch = await prisma.paymentSettlementBatch.create({ data: { reference: `STL-${marker}`, provider: "SSLCOMMERZ", externalBatchReference: `RESOLUTION-${marker}`, settlementDate: new Date(), currency: "BDT", status: "EXCEPTIONS", sourceFingerprint: `source-${marker}`, idempotencyKey: `batch-${marker}`, importedById: maker.user.id, rowCount: 2, matchedCount: 0, exceptionCount: 2 } }); ids.batches.push(batch.id);
  for (let rowNumber = 1; rowNumber <= 2; rowNumber += 1) {
    const entry = await prisma.paymentSettlementEntry.create({ data: { batchId: batch.id, rowNumber, externalTransactionId: `MISSING-${rowNumber}-${marker}`, grossAmount: 1000, gatewayFee: 25, netAmount: 975, currency: "BDT", settledAt: new Date(), matchStatus: "PAYMENT_NOT_FOUND", exceptionReason: "Synthetic missing payment for verification.", evidenceFingerprint: `entry-${rowNumber}-${marker}` } }); ids.entries.push(entry.id);
  }
  const financialBefore = { payments: await prisma.paymentIntent.count(), refunds: await prisma.refund.count(), walletTransactions: await prisma.walletTransaction.count() };
  const proposalBody = { resolutionType: "PROVIDER_REPORT_ERROR", reason: "Merchant evidence confirms this row was exported in error.", evidenceReference: `CASE-${marker}` };
  const missingOrigin = await post(`/api/v1/finance/payment-reconciliation/${ids.entries[0]}/proposals`, maker.cookie, `origin-${marker}`, proposalBody, false);
  assert(missingOrigin.response.status === 403 && missingOrigin.body.error?.code === "UNTRUSTED_ORIGIN", "Proposal accepted a missing trusted Origin.");
  const proposalKey = `proposal-${marker}`;
  const proposed = await post(`/api/v1/finance/payment-reconciliation/${ids.entries[0]}/proposals`, maker.cookie, proposalKey, proposalBody);
  assert(proposed.response.status === 201, `Proposal failed: ${JSON.stringify(proposed.body)}`); ids.proposals.push(proposed.body.data.proposal.id);
  assert(!("idempotencyKey" in proposed.body.data.proposal) && !("requestFingerprint" in proposed.body.data.proposal) && !("proposedById" in proposed.body.data.proposal), "Proposal response exposed internal security metadata.");
  const proposalReplay = await post(`/api/v1/finance/payment-reconciliation/${ids.entries[0]}/proposals`, maker.cookie, proposalKey, proposalBody);
  assert(proposalReplay.response.status === 200 && proposalReplay.body.data.idempotentReplay, "Proposal was not idempotent.");
  const sameUser = await post(`/api/v1/finance/payment-reconciliation/proposals/${ids.proposals[0]}/decision`, maker.cookie, `same-user-${marker}`, { decision: "APPROVED", reason: "Attempted self approval must be rejected." });
  assert(sameUser.response.status === 403 && sameUser.body.error?.code === "SETTLEMENT_INDEPENDENT_REVIEW_REQUIRED", "Maker was allowed to review their own proposal.");
  const decisionKey = `decision-${marker}`;
  const approved = await post(`/api/v1/finance/payment-reconciliation/proposals/${ids.proposals[0]}/decision`, checker.cookie, decisionKey, { decision: "APPROVED", reason: "Independent merchant evidence review confirms the report error." });
  assert(approved.response.status === 201 && approved.body.data.resolutionDecision.decision === "APPROVED", `Approval failed: ${JSON.stringify(approved.body)}`); ids.decisions.push(approved.body.data.resolutionDecision.id);
  assert(!("idempotencyKey" in approved.body.data.resolutionDecision) && !("requestFingerprint" in approved.body.data.resolutionDecision) && !("reviewedById" in approved.body.data.resolutionDecision), "Decision response exposed internal security metadata.");
  const decisionReplay = await post(`/api/v1/finance/payment-reconciliation/proposals/${ids.proposals[0]}/decision`, checker.cookie, decisionKey, { decision: "APPROVED", reason: "Independent merchant evidence review confirms the report error." });
  assert(decisionReplay.response.status === 200 && decisionReplay.body.data.idempotentReplay, "Decision was not idempotent.");
  const locked = await post(`/api/v1/finance/payment-reconciliation/${ids.entries[0]}/proposals`, maker.cookie, `locked-${marker}`, proposalBody);
  assert(locked.response.status === 422 && locked.body.error?.code === "SETTLEMENT_ALREADY_RESOLVED", "Resolved exception accepted another proposal.");

  const rejectedProposal = await post(`/api/v1/finance/payment-reconciliation/${ids.entries[1]}/proposals`, maker.cookie, `reject-proposal-${marker}`, { ...proposalBody, reason: "First evidence package requires independent correction." });
  assert(rejectedProposal.response.status === 201, "Correctable proposal setup failed."); ids.proposals.push(rejectedProposal.body.data.proposal.id);
  const rejected = await post(`/api/v1/finance/payment-reconciliation/proposals/${ids.proposals[1]}/decision`, checker.cookie, `reject-decision-${marker}`, { decision: "REJECTED", reason: "The evidence reference does not prove the provider report error." });
  assert(rejected.response.status === 201 && rejected.body.data.resolutionDecision.decision === "REJECTED", "Independent rejection failed."); ids.decisions.push(rejected.body.data.resolutionDecision.id);
  const correctedProposal = await post(`/api/v1/finance/payment-reconciliation/${ids.entries[1]}/proposals`, maker.cookie, `corrected-proposal-${marker}`, { ...proposalBody, reason: "Replacement merchant evidence now confirms the exported report error.", evidenceReference: `CASE-CORRECTED-${marker}` });
  assert(correctedProposal.response.status === 201, "Rejected proposal could not be replaced with corrected evidence."); ids.proposals.push(correctedProposal.body.data.proposal.id);
  const financialAfter = { payments: await prisma.paymentIntent.count(), refunds: await prisma.refund.count(), walletTransactions: await prisma.walletTransaction.count() };
  assert(JSON.stringify(financialBefore) === JSON.stringify(financialAfter), "Resolution workflow changed financial records.");
  assert(await prisma.auditLog.count({ where: { entityType: "PaymentSettlementEntry", entityId: { in: ids.entries }, action: { startsWith: "payment.settlement_resolution_" } } }) === 5, "Resolution audit evidence is incomplete.");
  let immutable = false;
  try { await prisma.paymentSettlementResolutionDecision.update({ where: { id: ids.decisions[0] }, data: { reason: "Attempted mutation" } }); } catch { immutable = true; }
  assert(immutable, "Database allowed an immutable reconciliation decision to change.");
  console.log("Payment reconciliation resolution verification passed: MFA Finance access, trusted origin, maker/checker separation, idempotency, correction after rejection, approved-case lock, immutable evidence, audit history, and zero financial mutation.");
} finally {
  if (ids.batches.length) await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('ALTER TABLE "PaymentSettlementResolutionDecision" DISABLE TRIGGER "PaymentSettlementResolutionDecision_immutable"');
    await tx.$executeRawUnsafe('ALTER TABLE "PaymentSettlementResolutionProposal" DISABLE TRIGGER "PaymentSettlementResolutionProposal_immutable"');
    await tx.$executeRawUnsafe('ALTER TABLE "PaymentSettlementEntry" DISABLE TRIGGER "PaymentSettlementEntry_immutable"');
    await tx.$executeRawUnsafe('ALTER TABLE "PaymentSettlementBatch" DISABLE TRIGGER "PaymentSettlementBatch_immutable"');
    await tx.paymentSettlementResolutionDecision.deleteMany({ where: { settlementEntryId: { in: ids.entries } } });
    await tx.paymentSettlementResolutionProposal.deleteMany({ where: { settlementEntryId: { in: ids.entries } } });
    await tx.paymentSettlementEntry.deleteMany({ where: { id: { in: ids.entries } } });
    await tx.paymentSettlementBatch.deleteMany({ where: { id: { in: ids.batches } } });
    await tx.$executeRawUnsafe('ALTER TABLE "PaymentSettlementBatch" ENABLE TRIGGER "PaymentSettlementBatch_immutable"');
    await tx.$executeRawUnsafe('ALTER TABLE "PaymentSettlementEntry" ENABLE TRIGGER "PaymentSettlementEntry_immutable"');
    await tx.$executeRawUnsafe('ALTER TABLE "PaymentSettlementResolutionProposal" ENABLE TRIGGER "PaymentSettlementResolutionProposal_immutable"');
    await tx.$executeRawUnsafe('ALTER TABLE "PaymentSettlementResolutionDecision" ENABLE TRIGGER "PaymentSettlementResolutionDecision_immutable"');
  });
  if (ids.sessions.length) await prisma.authSession.deleteMany({ where: { id: { in: ids.sessions } } });
  if (ids.users.length) { await prisma.userRole.deleteMany({ where: { userId: { in: ids.users } } }); await prisma.auditLog.deleteMany({ where: { actorId: { in: ids.users } } }); await prisma.user.deleteMany({ where: { id: { in: ids.users } } }); }
  await prisma.$disconnect();
}
