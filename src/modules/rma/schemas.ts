import { z } from "zod";
import { RMA_EVIDENCE_PATTERN } from "@/modules/rma/policy";

export const rmaReasons = ["NOT_DELIVERED", "LOST", "WRONG_ITEM", "DAMAGED", "NOT_AS_DESCRIBED", "MISSING_PARTS", "MINOR_COSMETIC", "OTHER"] as const;
const evidenceReference = z.string().trim().max(500).regex(RMA_EVIDENCE_PATTERN, "Use an approved private rma-evidence reference.");

export const createRmaSchema = z.object({
  shipmentId: z.string().uuid(),
  packageIds: z.array(z.string().uuid()).min(1).max(50),
  reason: z.enum(rmaReasons),
  description: z.string().trim().min(10).max(2000),
  evidenceReferences: z.array(evidenceReference).min(1).max(10),
});

export const adminCreateRmaSchema = createRmaSchema.extend({
  overrideReason: z.string().trim().min(10).max(1000),
});

export const rmaMessageSchema = z.object({
  body: z.string().trim().min(2).max(2000),
  evidenceReferences: z.array(evidenceReference).max(10).default([]),
});

export const returnTrackingSchema = z.object({
  trackingNumber: z.string().trim().min(4).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9 ._/-]*$/, "Enter a valid return tracking number."),
});

export const adminRmaActionSchema = z.object({
  action: z.enum(["APPROVE", "REJECT", "MARK_RETURN_RECEIVED", "APPROVE_REFUND", "APPROVE_REPLACEMENT", "CLOSE"]),
  note: z.string().trim().min(5).max(2000),
  returnRequired: z.boolean().optional(),
  returnInstructions: z.string().trim().max(2000).optional(),
  liabilityParty: z.enum(["CUSTOMER", "PLATFORM", "SUPPLIER", "CARRIER"]).optional(),
  approvedRefundAmount: z.coerce.number().positive().max(100_000_000).optional(),
  version: z.number().int().positive(),
}).superRefine((value, context) => {
  if (value.action === "APPROVE" && value.returnRequired && !value.returnInstructions) context.addIssue({ code: "custom", path: ["returnInstructions"], message: "Return instructions are required when a physical return is required." });
  if (value.action === "APPROVE_REFUND" && (!value.approvedRefundAmount || !value.liabilityParty)) context.addIssue({ code: "custom", path: ["approvedRefundAmount"], message: "Refund amount and liability allocation are required." });
  if (value.action === "APPROVE_REPLACEMENT" && !value.liabilityParty) context.addIssue({ code: "custom", path: ["liabilityParty"], message: "Liability allocation is required." });
});

export const inspectRmaSchema = z.object({
  result: z.enum(["CONFIRMED", "PARTIALLY_CONFIRMED", "NOT_CONFIRMED"]),
  notes: z.string().trim().min(5).max(2000),
  evidenceReferences: z.array(evidenceReference).max(10).default([]),
  version: z.number().int().positive(),
});
