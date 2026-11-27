import "server-only";
import type { Prisma } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";
import { matchVideoManifest, videoManifestHash, videoManifestSchema } from "./video-provenance";
import { parsePrivateVideoArtifactReference } from "./video-artifacts";

// Metadata only: never select staged ciphertext or private bytes for the queue.
export const videoSafetyJobSelect = {
  id: true, actorId: true, packageId: true, profile: true, status: true, createdAt: true, updatedAt: true, leaseToken: true, leaseExpiresAt: true,
  quarantine: { select: { reason: true, caseReference: true, createdAt: true } },
  processingProof: { select: { id: true, manifest: true, manifestSha256: true, verifiedAt: true } },
  evidenceLink: { select: { status: true, processingProofId: true, evidence: { select: { createdAt: true } } } },
  artifacts: { select: { role: true, status: true, preparedReference: true, storedReference: true } },
  package: { select: { packageCode: true, orderId: true, order: { select: { status: true, customerId: true, updatedAt: true } } } },
} as const;
type Job = Prisma.PrivateVideoJobGetPayload<{ select: typeof videoSafetyJobSelect }>;
type Policy = { sequence: number; inspectionDays: number; abandonedHours: number } | null;
type Tx = Prisma.TransactionClient;

/** Conservative review metadata, never an execution/approval token. */
export async function videoRetentionReview(tx: Tx, job: Job, policy: Policy, now: Date) {
  let reviewAfter: Date | null = null, anchor = job.createdAt.getTime(), minimum = 0;
  const result = (state: string, reasons: string[] = [state]) => ({ state, reasons, reviewAfter, policySequence: policy?.sequence ?? null, deletionAllowed: false as const });
  const valid = (date: Date | null | undefined) => Boolean(date && Number.isFinite(date.getTime()) && date <= now);
  const track = (date: Date | null | undefined) => { if (date) anchor = Math.max(anchor, date.getTime()); };
  if (job.quarantine) return result("QUARANTINED");
  const orderId = job.package.orderId, customerId = job.package.order.customerId;
  if (await tx.privateMediaHold.findFirst({ where: { release: null, OR: [{ accountId: { in: [job.actorId, customerId] } }, { orderId }, { packageId: job.packageId }] }, select: { id: true } })) return result("LEGAL_HOLD");
  if (!policy) return result("POLICY_REQUIRED");
  if (job.status !== "STORED" || job.leaseToken || job.leaseExpiresAt || !job.processingProof) return result("STORAGE_REVIEW_REQUIRED");
  try {
    const manifest = videoManifestSchema.parse(job.processingProof.manifest);
    if (videoManifestHash(manifest) !== job.processingProof.manifestSha256) throw new Error();
    matchVideoManifest(manifest, job.profile, job.artifacts);
  } catch { return result("STORAGE_REVIEW_REQUIRED"); }
  for (const artifact of job.artifacts) {
    try {
      const { versionId, ...metadata } = parsePrivateVideoArtifactReference(artifact.storedReference);
      if (!versionId || artifact.status !== "STORED" || !isDeepStrictEqual(metadata, artifact.preparedReference)) return result("STORAGE_REVIEW_REQUIRED");
    } catch { return result("STORAGE_REVIEW_REQUIRED"); }
  }
  if (!valid(job.createdAt) || !valid(job.updatedAt) || !valid(job.processingProof.verifiedAt) || job.processingProof.verifiedAt < job.createdAt) return result("TIME_REVIEW_REQUIRED");
  if (job.evidenceLink && (job.evidenceLink.processingProofId !== job.processingProof.id || job.evidenceLink.status !== "STAGED" || !valid(job.evidenceLink.evidence.createdAt))) return result("CONTEXT_REVIEW_REQUIRED");
  track(job.updatedAt); track(job.processingProof.verifiedAt); track(job.evidenceLink?.evidence.createdAt);
  const accounts = await tx.user.findMany({ where: { id: { in: [job.actorId, customerId] } }, select: { status: true, deletedAt: true, kycStatus: true } });
  if (accounts.some(row => row.status !== "ACTIVE" || row.deletedAt || row.kycStatus === "PENDING")) return result("ACCOUNT_REVIEW_REQUIRED");
  if (job.package.order.status !== "DELIVERED") return result("DELIVERY_REVIEW_REQUIRED");
  const delivered = await tx.orderStatusHistory.findFirst({ where: { orderId, toStatus: "DELIVERED" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  if (!delivered || !valid(delivered.createdAt)) return result("DELIVERY_REVIEW_REQUIRED");
  track(delivered.createdAt);
  const parcels = await tx.package.findMany({ where: { orderId, OR: [{ isOutboundActive: true }, { shipmentPackages: { some: {} } }] }, take: 51, select: { shipmentPackages: { take: 2, select: { shipment: { select: { status: true, deliveredAt: true, claimDeadline: true, updatedAt: true, events: { where: { status: "DELIVERED" }, take: 1, orderBy: { occurredAt: "desc" }, select: { occurredAt: true } } } } } } } });
  if (parcels.length > 50) return result("HISTORY_REVIEW_REQUIRED");
  if (!parcels.length) return result("DELIVERY_REVIEW_REQUIRED");
  for (const parcel of parcels) {
    if (parcel.shipmentPackages.length !== 1) return result("DELIVERY_REVIEW_REQUIRED");
    const shipment = parcel.shipmentPackages[0].shipment;
    if (shipment.status !== "DELIVERED" || !valid(shipment.deliveredAt) || !valid(shipment.updatedAt) || !valid(shipment.events[0]?.occurredAt) || !shipment.claimDeadline || shipment.claimDeadline < shipment.deliveredAt!) return result("DELIVERY_REVIEW_REQUIRED");
    track(shipment.deliveredAt); track(shipment.updatedAt); track(shipment.events[0].occurredAt); minimum = Math.max(minimum, shipment.claimDeadline.getTime());
  }
  const limit = 51;
  const [tickets, rmas, refunds, exceptions, services, payments, shippingPayments, screenings, settlements] = await Promise.all([
    tx.ticket.findMany({ where: { customerId, OR: [{ orderId }, { orderId: null }] }, take: limit, select: { status: true, resolvedAt: true, updatedAt: true } }),
    tx.rma.findMany({ where: { orderId }, take: limit, select: { status: true, decision: true, resolvedAt: true, updatedAt: true } }),
    tx.refund.findMany({ where: { orderId }, take: limit, select: { status: true, processedAt: true, updatedAt: true } }),
    tx.packageException.findMany({ where: { orderId }, take: limit, select: { status: true, resolvedAt: true, updatedAt: true } }),
    tx.packageServiceRequest.findMany({ where: { orderId }, take: limit, select: { status: true, completedAt: true, reviewedAt: true, updatedAt: true } }),
    tx.paymentIntent.findMany({ where: { orderId }, take: limit, select: { status: true, updatedAt: true } }),
    tx.shippingPayment.findMany({ where: { orderId }, take: limit, select: { status: true, updatedAt: true } }),
    tx.complianceScreeningAttempt.findMany({ where: { customerId, outcome: { in: ["REVIEW_REQUIRED", "APPROVED", "REJECTED"] } }, take: limit, select: { outcome: true, reviewedAt: true, updatedAt: true } }),
    tx.paymentSettlementEntry.findMany({ where: { paymentIntent: { orderId } }, take: limit, select: { matchStatus: true, settledAt: true, createdAt: true, resolutionDecisions: { where: { decision: "APPROVED" }, take: 1, orderBy: { reviewedAt: "desc" }, select: { reviewedAt: true } } } }),
  ]);
  if ([tickets, rmas, refunds, exceptions, services, payments, shippingPayments, screenings, settlements].some(rows => rows.length > 50)) return result("HISTORY_REVIEW_REQUIRED");
  const cases = [
    ...tickets.map(row => ({ closed: ["RESOLVED", "CLOSED"].includes(row.status), completedAt: row.resolvedAt, updatedAt: row.updatedAt })),
    ...rmas.map(row => ({ closed: ["RETURN_REJECTED", "REFUNDED", "REPLACED", "CLOSED"].includes(row.status) && row.decision !== "PENDING", completedAt: row.resolvedAt, updatedAt: row.updatedAt })),
    ...refunds.map(row => ({ closed: ["SUCCEEDED", "REJECTED"].includes(row.status), completedAt: row.status === "REJECTED" ? row.updatedAt : row.processedAt, updatedAt: row.updatedAt })),
    ...exceptions.map(row => ({ closed: ["RESOLVED", "CANCELLED"].includes(row.status), completedAt: row.status === "CANCELLED" ? row.updatedAt : row.resolvedAt, updatedAt: row.updatedAt })),
    ...services.map(row => ({ closed: ["COMPLETED", "REJECTED", "CANCELLED"].includes(row.status), completedAt: row.status === "COMPLETED" ? row.completedAt : row.reviewedAt ?? row.updatedAt, updatedAt: row.updatedAt })),
  ];
  if (cases.some(row => !row.closed || !valid(row.completedAt) || !valid(row.updatedAt))) return result("CASE_REVIEW_REQUIRED");
  for (const row of cases) { track(row.completedAt); track(row.updatedAt); }
  if ([...payments, ...shippingPayments].some(row => ["CREATED", "PENDING"].includes(row.status))) return result("PAYMENT_REVIEW_REQUIRED");
  for (const row of [...payments, ...shippingPayments]) { if (!valid(row.updatedAt)) return result("TIME_REVIEW_REQUIRED"); track(row.updatedAt); }
  if (screenings.some(row => row.outcome === "REVIEW_REQUIRED" || !valid(row.reviewedAt) || !valid(row.updatedAt))) return result("COMPLIANCE_REVIEW_REQUIRED");
  for (const row of screenings) { track(row.reviewedAt); track(row.updatedAt); }
  for (const row of settlements) {
    if (row.matchStatus !== "MATCHED" && !row.resolutionDecisions[0] || !valid(row.settledAt) || !valid(row.createdAt) || row.resolutionDecisions[0] && !valid(row.resolutionDecisions[0].reviewedAt)) return result("FINANCE_REVIEW_REQUIRED");
    track(row.settledAt); track(row.createdAt); track(row.resolutionDecisions[0]?.reviewedAt);
  }
  const due = Math.max(anchor + (job.evidenceLink ? policy.inspectionDays * 86400000 : policy.abandonedHours * 3600000), minimum);
  if (!Number.isFinite(due) || due > 8_640_000_000_000_000) return result("TIME_REVIEW_REQUIRED");
  reviewAfter = new Date(due);
  return result(due > now.getTime() ? "RETENTION_RUNNING" : "INDEPENDENT_REVIEW_REQUIRED");
}
