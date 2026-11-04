import { z } from "zod";

const optionalCountry = z.union([z.literal(""), z.string().trim().length(2).toUpperCase()]).optional();
const optionalDate = z.union([z.literal(""), z.coerce.date()]).optional();

export const restrictedGoodsRuleCreateSchema = z.object({
  ruleCode: z.string().trim().min(3).max(40).regex(/^[A-Za-z0-9_-]+$/).transform((value) => value.toUpperCase()),
  name: z.string().trim().min(3).max(120),
  internalDescription: z.string().trim().max(1000).optional(),
  customerMessage: z.string().trim().min(10).max(300),
  action: z.enum(["BLOCK", "MANUAL_REVIEW"]),
  keywords: z.array(z.string().trim().min(2).max(100)).max(100).default([]),
  hsCodePrefixes: z.array(z.string().trim().regex(/^\d{2,10}$/)).max(100).default([]),
  originCountryCode: optionalCountry,
  destinationCountryCode: optionalCountry,
  effectiveFrom: optionalDate,
  effectiveTo: optionalDate,
  legalReference: z.string().trim().max(500).optional(),
}).superRefine((value, context) => {
  if (!value.keywords.length && !value.hsCodePrefixes.length) context.addIssue({ code: "custom", path: ["keywords"], message: "Add at least one keyword or HS-code prefix." });
  if (value.effectiveFrom && value.effectiveTo && value.effectiveTo <= value.effectiveFrom) context.addIssue({ code: "custom", path: ["effectiveTo"], message: "End time must be after start time." });
});

export const restrictedGoodsRuleStatusSchema = z.object({ status: z.enum(["ACTIVE", "PAUSED", "ARCHIVED"]), version: z.number().int().positive() });
export const complianceDecisionSchema = z.object({ decision: z.enum(["APPROVED", "REJECTED"]), version: z.number().int().positive(), note: z.string().trim().min(5).max(1000) });
export const complianceStaffAssignmentSchema = z.object({ email: z.string().trim().email().transform((value) => value.toLowerCase()) }).strict();
