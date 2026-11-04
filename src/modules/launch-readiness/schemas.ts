import { z } from "zod";

export const launchReadinessCategories = ["INFRASTRUCTURE", "PAYMENTS", "IDENTITY_DELIVERY", "MEDIA", "LEGAL_COMPLIANCE", "OPERATIONS", "STAFFING", "SECURITY", "AUTOMATION", "OTHER"] as const;
export const launchReadinessStatuses = ["NOT_STARTED", "IN_PROGRESS", "BLOCKED", "EVIDENCE_RECORDED", "VERIFIED"] as const;

const safeOptionalText = (maximum: number) => z.string().trim().max(maximum).optional().nullable().transform((value) => value || null);
const evidenceReference = safeOptionalText(500).refine((value) => !value || !/(?:secret|password|token|api[-_ ]?key|private[-_ ]?key)\s*[:=]/i.test(value), "Enter an evidence location or reference, never a credential or secret.");

export const launchReadinessCreateSchema = z.object({
  category: z.enum(launchReadinessCategories),
  title: z.string().trim().min(3).max(120),
  requirement: z.string().trim().min(10).max(1500),
  isRequired: z.boolean().default(true),
  ownerName: safeOptionalText(120),
  dueAt: z.coerce.date().optional().nullable(),
}).strict();

export const launchReadinessUpdateSchema = z.object({
  category: z.enum(launchReadinessCategories),
  title: z.string().trim().min(3).max(120),
  requirement: z.string().trim().min(10).max(1500),
  status: z.enum(launchReadinessStatuses),
  isRequired: z.boolean(),
  ownerName: safeOptionalText(120),
  dueAt: z.coerce.date().optional().nullable(),
  evidenceReference,
  evidenceNote: safeOptionalText(2000),
  blockerReason: safeOptionalText(1000),
  version: z.number().int().positive(),
  verificationConfirmed: z.boolean().default(false),
}).strict().superRefine((value, context) => {
  if (value.status === "BLOCKED" && !value.blockerReason) context.addIssue({ code: "custom", path: ["blockerReason"], message: "A blocked item requires a reason." });
  if (value.status === "EVIDENCE_RECORDED" && (!value.evidenceReference || !value.evidenceNote)) context.addIssue({ code: "custom", path: ["evidenceReference"], message: "Recorded evidence requires both a reference and a review note." });
  if (value.status === "VERIFIED" && (!value.evidenceReference || !value.evidenceNote || !value.verificationConfirmed)) context.addIssue({ code: "custom", path: ["verificationConfirmed"], message: "Verification requires evidence, a review note, and explicit confirmation." });
});
