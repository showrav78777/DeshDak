import { z } from "zod";

export const kamStaffSchema = z.object({ email: z.string().trim().email().transform((value) => value.toLowerCase()) });

export const businessAccountAssignmentSchema = z.object({
  customerEmail: z.string().trim().email().transform((value) => value.toLowerCase()),
  kamEmail: z.string().trim().email().transform((value) => value.toLowerCase()),
  organizationName: z.string().trim().min(2).max(160),
});

export const accountActivitySchema = z.object({
  type: z.enum(["CALL", "MEETING", "EMAIL", "NOTE", "FOLLOW_UP"]),
  subject: z.string().trim().min(2).max(160),
  note: z.string().trim().min(2).max(2000),
  occurredAt: z.coerce.date(),
  followUpAt: z.coerce.date().optional(),
  sourcingRequestId: z.string().uuid().optional(),
}).superRefine((value, context) => {
  const now = Date.now();
  if (value.occurredAt.getTime() > now + 5 * 60_000) context.addIssue({ code: "custom", path: ["occurredAt"], message: "Activity time cannot be in the future." });
  if (value.followUpAt && value.followUpAt <= value.occurredAt) context.addIssue({ code: "custom", path: ["followUpAt"], message: "Follow-up must be after the activity." });
});

export const opportunityCreateSchema = z.object({
  title: z.string().trim().min(2).max(180),
  sourcingRequestId: z.string().uuid().optional(),
  estimatedValue: z.coerce.number().positive().max(999999999999.99).optional(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).optional(),
  expectedCloseAt: z.coerce.date().optional(),
  note: z.string().trim().max(2000).optional(),
}).superRefine((value, context) => {
  if ((value.estimatedValue === undefined) !== (value.currency === undefined)) context.addIssue({ code: "custom", path: ["currency"], message: "Estimated value and currency must be provided together." });
});

export const opportunityStageSchema = z.object({
  stage: z.enum(["DISCOVERY", "QUALIFIED", "QUOTED", "NEGOTIATION", "WON", "LOST"]),
  version: z.number().int().positive(),
  note: z.string().trim().max(1000).optional(),
});
