import "server-only";
import type { Prisma } from "@prisma/client";
import { z } from "zod";

export const mediaPreviewQuery = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1), purpose: z.enum(["all", "identity", "inspection"]).default("all"), uploadId: z.preprocess(value => value === "" ? undefined : value, z.uuid().optional()) }).strict();
export const mediaPreviewReasons = {
  POLICY_REQUIRED: "Record a Compliance-reviewed retention policy first.",
  QUARANTINED: "The photo is quarantined and needs its controlled safety review.",
  LEGAL_HOLD: "An active preservation hold applies to this photo or its related records.",
  STORAGE_UNCONFIRMED: "Storage or scan confirmation is incomplete; reconcile the upload first.",
  INVALID_TIME: "A required timestamp is missing, inconsistent or in the future.",
  CONTEXT_REQUIRED: "The inspection upload has no confirmed customer/order context.",
  CONTEXT_CHANGED: "The photo and its linked subject metadata do not match.",
  ACCOUNT_REVIEW: "The account is under review or has a pending identity decision.",
  CURRENT_IDENTITY: "A current verified identity document is preserved while the account is active.",
  IDENTITY_REVIEW_REQUIRED: "A final identity decision and review timestamp are required.",
  DELIVERY_REQUIRED: "The order is not delivered or lacks complete delivery and claim-window records.",
  SUPPORT_REVIEW_REQUIRED: "A related support case is open or lacks completion records.",
  RETURN_REVIEW_REQUIRED: "A related return or claim is open or lacks completion records.",
  REFUND_REVIEW_REQUIRED: "A related refund needs a final, recorded outcome.",
  WAREHOUSE_REVIEW_REQUIRED: "A related warehouse exception needs review.",
  SERVICE_REVIEW_REQUIRED: "Related package handling is unfinished or lacks completion records.",
  PAYMENT_REVIEW_REQUIRED: "A related payment is still pending.",
  ORDER_REVIEW_REQUIRED: "An order on this account remains active.",
  CASE_RECORD_INCOMPLETE: "A closed case is missing its completion timestamp.",
  COMPLIANCE_REVIEW: "An unresolved customer compliance screening remains.",
  FINANCE_REVIEW: "A linked settlement exception requires Finance review.",
  HISTORY_REVIEW: "The related history exceeds this bounded preview; arrange manual review.",
  RETENTION_RUNNING: "The retention period or claim window has not ended.",
  READY_FOR_REVIEW: "The recorded waiting period has elapsed and checked records have no blocker. Independent deletion review is still required.",
} as const;
type Reason = keyof typeof mediaPreviewReasons;
type Tx = Prisma.TransactionClient;
type Policy = { sequence: number; identityDays: number; inspectionDays: number; abandonedHours: number };
type HoldReader = (tx: Tx, uploadId: string) => Promise<Array<{ id: string }>>;
const caseLimit = 100;
const day = 86_400_000;

/** Read-only review scheduling. Never use this result as authorization to remove bytes. */
async function evaluate(tx: Tx, id: string, policy: Policy | null, now: Date, holds: HoldReader) {
  const row = await tx.privatePhotoUpload.findUniqueOrThrow({ where: { id }, select: {
    id: true, actorId: true, purpose: true, status: true, createdAt: true, updatedAt: true, leaseToken: true,
    originalScanSha256: true, originalScanVerifiedAt: true, scanVerifiedSha256: true, scanVerifiedAt: true,
    quarantine: { select: { id: true } },
    privatePhotoLink: { select: {
      identityVerification: { select: { userId: true, status: true, submittedAt: true, reviewedAt: true, documentPhotoSha256: true } },
      inspectionEvidence: { select: { uploadedById: true, sha256: true, createdAt: true, package: { select: { orderId: true } } } },
    } },
  } });
  let anchor = Math.max(row.createdAt.getTime(), row.updatedAt.getTime());
  let minimum = 0;
  let reviewAfter: Date | null = null;
  const outcome = (reasons: Reason[], state: "BLOCKED" | "WAITING" | "READY_FOR_REVIEW" = "BLOCKED") => ({ uploadId: row.id, purpose: row.purpose, state, reasons, reviewAfter, deletionAllowed: false as const });
  const valid = (date: Date | null | undefined) => Boolean(date && Number.isFinite(date.getTime()) && date.getTime() <= now.getTime());
  const track = (date: Date | null | undefined) => { if (date) anchor = Math.max(anchor, date.getTime()); };
  const base: Reason[] = [];
  if (!policy) base.push("POLICY_REQUIRED");
  if (row.quarantine) base.push("QUARANTINED");
  if ((await holds(tx, id)).length) base.push("LEGAL_HOLD");
  if (row.status !== "STORED" || row.leaseToken || !row.originalScanSha256?.match(/^[a-f0-9]{64}$/) || !row.scanVerifiedSha256?.match(/^[a-f0-9]{64}$/) || !valid(row.originalScanVerifiedAt) || !valid(row.scanVerifiedAt)) base.push("STORAGE_UNCONFIRMED");
  if (!valid(row.createdAt) || !valid(row.updatedAt) || row.updatedAt < row.createdAt || row.originalScanVerifiedAt && row.scanVerifiedAt && (row.originalScanVerifiedAt > row.scanVerifiedAt || row.scanVerifiedAt < row.createdAt)) base.push("INVALID_TIME");
  if (base.length || !policy) return outcome(base);
  track(row.scanVerifiedAt);
  const identity = row.privatePhotoLink?.identityVerification;
  const evidence = row.privatePhotoLink?.inspectionEvidence;
  if (identity && (identity.userId !== row.actorId || identity.documentPhotoSha256 !== row.scanVerifiedSha256) || evidence && (evidence.uploadedById !== row.actorId || evidence.sha256 !== row.scanVerifiedSha256)) return outcome(["CONTEXT_CHANGED"]);
  const orderId = evidence?.package.orderId;
  const order = orderId ? await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { customerId: true, status: true } }) : null;
  const accountId = identity?.userId ?? order?.customerId ?? (row.purpose === "identity" ? row.actorId : null);
  if (!accountId) return outcome(["CONTEXT_REQUIRED"]);
  const account = await tx.user.findUniqueOrThrow({ where: { id: accountId }, select: { status: true, kycStatus: true, deletedAt: true } });
  if (account.status !== "ACTIVE" || account.kycStatus === "PENDING" || await tx.identityVerification.findFirst({ where: { userId: accountId, status: "PENDING" }, select: { id: true } })) return outcome(["ACCOUNT_REVIEW"]);
  let duration = policy.abandonedHours * 3_600_000;
  if (identity) {
    if (!["VERIFIED", "REJECTED"].includes(identity.status) || !identity.reviewedAt) return outcome(["IDENTITY_REVIEW_REQUIRED"]);
    if (!valid(identity.submittedAt) || !valid(identity.reviewedAt) || identity.reviewedAt < identity.submittedAt) return outcome(["INVALID_TIME"]);
    if (identity.status === "VERIFIED" && account.status === "ACTIVE" && !account.deletedAt) return outcome(["CURRENT_IDENTITY"]);
    track(identity.reviewedAt); duration = policy.identityDays * day;
  } else if (evidence && orderId && order) {
    if (order.status !== "DELIVERED") return outcome(["DELIVERY_REQUIRED"]);
    if (!valid(evidence.createdAt)) return outcome(["INVALID_TIME"]);
    track(evidence.createdAt); duration = policy.inspectionDays * day;
    const history = await tx.orderStatusHistory.findFirst({ where: { orderId, toStatus: "DELIVERED" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    if (!history || !valid(history.createdAt)) return outcome(["DELIVERY_REQUIRED"]);
    track(history.createdAt);
    const parcels = await tx.package.findMany({ where: { orderId, isOutboundActive: true }, take: caseLimit + 1, select: { shipmentPackages: { select: { shipment: { select: { status: true, deliveredAt: true, claimDeadline: true, updatedAt: true, events: { where: { status: "DELIVERED" }, orderBy: { occurredAt: "desc" }, take: 1, select: { occurredAt: true } } } } } } } });
    if (parcels.length > caseLimit) return outcome(["HISTORY_REVIEW"]);
    if (!parcels.length) return outcome(["DELIVERY_REQUIRED"]);
    for (const parcel of parcels) {
      if (parcel.shipmentPackages.length !== 1) return outcome(["DELIVERY_REQUIRED"]);
      const shipment = parcel.shipmentPackages[0].shipment;
      if (shipment.status !== "DELIVERED" || !shipment.deliveredAt || !shipment.claimDeadline || !shipment.events[0]) return outcome(["DELIVERY_REQUIRED"]);
      if (!valid(shipment.deliveredAt) || !valid(shipment.updatedAt) || !valid(shipment.events[0].occurredAt) || shipment.claimDeadline < shipment.deliveredAt) return outcome(["INVALID_TIME"]);
      track(shipment.deliveredAt); track(shipment.updatedAt); track(shipment.events[0].occurredAt);
      minimum = Math.max(minimum, shipment.claimDeadline.getTime());
    }
  }
  const customerScope = !orderId;
  const scopedOrder = orderId ? { id: orderId } : { customerId: accountId };
  // Only known linked records are checked; external/unlinked investigations still need independent review.
  const screenings = await tx.complianceScreeningAttempt.findMany({ where: { customerId: accountId, outcome: { in: ["REVIEW_REQUIRED", "APPROVED", "REJECTED"] } }, take: caseLimit + 1, select: { outcome: true, reviewedAt: true, updatedAt: true } });
  if (screenings.length > caseLimit) return outcome(["HISTORY_REVIEW"]);
  for (const record of screenings) {
    if (record.outcome === "REVIEW_REQUIRED") return outcome(["COMPLIANCE_REVIEW"]);
    if (["APPROVED", "REJECTED"].includes(record.outcome) && !record.reviewedAt) return outcome(["CASE_RECORD_INCOMPLETE"]);
    if (!valid(record.updatedAt) || record.reviewedAt && !valid(record.reviewedAt)) return outcome(["INVALID_TIME"]);
    track(record.updatedAt); track(record.reviewedAt);
  }
  const tickets = await tx.ticket.findMany({ where: customerScope ? { customerId: accountId } : { customerId: accountId, OR: [{ orderId }, { orderId: null }] }, take: caseLimit + 1, select: { status: true, resolvedAt: true, updatedAt: true } });
  const rmas = await tx.rma.findMany({ where: orderId ? { orderId } : { customerId: accountId }, take: caseLimit + 1, select: { status: true, decision: true, resolvedAt: true, updatedAt: true } });
  const refunds = await tx.refund.findMany({ where: { order: scopedOrder }, take: caseLimit + 1, select: { status: true, processedAt: true, updatedAt: true } });
  const exceptions = await tx.packageException.findMany({ where: { order: scopedOrder }, take: caseLimit + 1, select: { status: true, resolvedAt: true, updatedAt: true } });
  const services = await tx.packageServiceRequest.findMany({ where: { order: scopedOrder }, take: caseLimit + 1, select: { status: true, completedAt: true, reviewedAt: true, updatedAt: true } });
  if ([tickets, rmas, refunds, exceptions, services].some(records => records.length > caseLimit)) return outcome(["HISTORY_REVIEW"]);
  const cases = [
    ...tickets.map(r => ({ reason: "SUPPORT_REVIEW_REQUIRED" as Reason, closed: ["RESOLVED", "CLOSED"].includes(r.status), completedAt: r.resolvedAt, updatedAt: r.updatedAt })),
    ...rmas.map(r => ({ reason: "RETURN_REVIEW_REQUIRED" as Reason, closed: ["RETURN_REJECTED", "REFUNDED", "REPLACED", "CLOSED"].includes(r.status) && r.decision !== "PENDING", completedAt: r.resolvedAt, updatedAt: r.updatedAt })),
    ...refunds.map(r => ({ reason: "REFUND_REVIEW_REQUIRED" as Reason, closed: ["SUCCEEDED", "REJECTED"].includes(r.status), completedAt: r.status === "REJECTED" ? r.updatedAt : r.processedAt, updatedAt: r.updatedAt })),
    ...exceptions.map(r => ({ reason: "WAREHOUSE_REVIEW_REQUIRED" as Reason, closed: ["RESOLVED", "CANCELLED"].includes(r.status), completedAt: r.status === "CANCELLED" ? r.updatedAt : r.resolvedAt, updatedAt: r.updatedAt })),
    ...services.map(r => ({ reason: "SERVICE_REVIEW_REQUIRED" as Reason, closed: ["COMPLETED", "REJECTED", "CANCELLED"].includes(r.status), completedAt: r.status === "COMPLETED" ? r.completedAt : r.reviewedAt ?? r.updatedAt, updatedAt: r.updatedAt })),
  ];
  const openCases = [...new Set(cases.filter(r => !r.closed).map(r => r.reason))];
  if (openCases.length) return outcome(openCases);
  if (cases.some(r => !r.completedAt)) return outcome(["CASE_RECORD_INCOMPLETE", ...new Set(cases.filter(r => !r.completedAt).map(r => r.reason))]);
  for (const record of cases) { if (!valid(record.completedAt) || !valid(record.updatedAt)) return outcome(["INVALID_TIME"]); track(record.completedAt); track(record.updatedAt); }
  const payments = await tx.paymentIntent.findMany({ where: { order: scopedOrder }, take: caseLimit + 1, select: { status: true, updatedAt: true } });
  const settlements = await tx.paymentSettlementEntry.findMany({ where: { paymentIntent: { order: scopedOrder } }, take: caseLimit + 1, select: { matchStatus: true, createdAt: true, settledAt: true, resolutionDecisions: { where: { decision: "APPROVED" }, orderBy: { reviewedAt: "desc" }, take: 1, select: { reviewedAt: true } } } });
  const shippingPayments = await tx.shippingPayment.findMany({ where: { order: scopedOrder }, take: caseLimit + 1, select: { status: true, updatedAt: true } });
  if (payments.length > caseLimit || shippingPayments.length > caseLimit || settlements.length > caseLimit) return outcome(["HISTORY_REVIEW"]);
  if ([...payments, ...shippingPayments].some(p => ["CREATED", "PENDING"].includes(p.status))) return outcome(["PAYMENT_REVIEW_REQUIRED"]);
  for (const payment of [...payments, ...shippingPayments]) { if (!valid(payment.updatedAt)) return outcome(["INVALID_TIME"]); track(payment.updatedAt); }
  for (const entry of settlements) {
    if (entry.matchStatus !== "MATCHED" && !entry.resolutionDecisions[0]) return outcome(["FINANCE_REVIEW"]);
    if (!valid(entry.createdAt) || !valid(entry.settledAt) || entry.resolutionDecisions[0] && !valid(entry.resolutionDecisions[0].reviewedAt)) return outcome(["INVALID_TIME"]);
    track(entry.createdAt); track(entry.settledAt); track(entry.resolutionDecisions[0]?.reviewedAt);
  }
  if (customerScope && await tx.order.findFirst({ where: { customerId: accountId, status: { notIn: ["DELIVERED", "CANCELLED", "REFUNDED"] } }, select: { id: true } })) return outcome(["ORDER_REVIEW_REQUIRED"]);
  const due = Math.max(anchor + duration, minimum);
  if (!Number.isFinite(due) || due > 8_640_000_000_000_000) return outcome(["INVALID_TIME"]);
  reviewAfter = new Date(due);
  return now.getTime() >= due ? outcome(["READY_FOR_REVIEW"], "READY_FOR_REVIEW") : outcome(["RETENTION_RUNNING"], "WAITING");
}

export async function buildMediaReviewPreview(tx: Tx, raw: z.input<typeof mediaPreviewQuery>, holds: HoldReader) {
  const query = mediaPreviewQuery.parse(raw);
  const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp()::timestamp(3) AS now`;
  const policy = await tx.privateMediaPolicy.findFirst({ orderBy: { sequence: "desc" }, select: { sequence: true, identityDays: true, inspectionDays: true, abandonedHours: true } });
  const uploads = await tx.privatePhotoUpload.findMany({ where: { ...(query.purpose === "all" ? {} : { purpose: query.purpose }), ...(query.uploadId ? { id: query.uploadId } : {}) }, orderBy: [{ updatedAt: "asc" }, { id: "asc" }], skip: (query.page - 1) * 10, take: 11, select: { id: true } });
  const rows = [];
  for (const upload of uploads.slice(0, 10)) rows.push(await evaluate(tx, upload.id, policy, clock.now, holds));
  return { ...query, pageSize: 10, hasMore: uploads.length > 10, policySequence: policy?.sequence ?? null, evaluatedAt: clock.now, deletionEnabled: false as const, rows };
}
