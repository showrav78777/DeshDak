import { z } from "zod";

const attachmentReference = z.string().trim().min(10).max(240).regex(/^support-evidence\/[A-Za-z0-9/_-]+\.[A-Za-z0-9]{2,8}$/, "Use a private support-evidence reference.");

export const createTicketSchema = z.object({
  category: z.enum(["ORDER", "PAYMENT", "SHIPPING", "RETURN_REFUND", "SOURCING", "ACCOUNT", "TECHNICAL", "GENERAL"]),
  subject: z.string().trim().min(5).max(160),
  body: z.string().trim().min(10).max(5000),
  orderId: z.string().uuid().optional(),
  rmaId: z.string().uuid().optional(),
  attachmentReferences: z.array(attachmentReference).max(5).default([]),
}).strict();

export const ticketMessageSchema = z.object({
  body: z.string().trim().min(1).max(5000),
  attachmentReferences: z.array(attachmentReference).max(5).default([]),
  internalNote: z.boolean().default(false),
}).strict();

export const ticketActionSchema = z.object({
  action: z.enum(["CLAIM", "ASSIGN", "SET_PRIORITY", "WAITING_FOR_CUSTOMER", "RESOLVE", "REOPEN", "CLOSE", "ESCALATE"]),
  version: z.number().int().min(1),
  agentId: z.string().uuid().optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
  note: z.string().trim().min(3).max(1000),
}).strict();

export const supportAgentAssignmentSchema = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
}).strict();

const supportLanguage = z.string().trim().min(2).max(12).regex(/^[a-z]{2}(?:-[A-Z]{2})?$/, "Use a language code such as bn, en, or en-US.");

export const supportAgentProfileSchema = z.object({
  availability: z.enum(["AVAILABLE", "BUSY", "OFFLINE"]),
  acceptingNewTickets: z.boolean(),
  maxActiveTickets: z.number().int().min(1).max(100),
  languages: z.array(supportLanguage).min(1).max(10).transform((items) => [...new Set(items)]),
  statusNote: z.preprocess((value) => value === "" || value === null ? null : value, z.string().trim().max(240).nullable()),
  version: z.number().int().min(1).optional(),
}).strict();

export const supportQualityReviewSchema = z.object({
  score: z.number().int().min(1).max(5),
  outcome: z.enum(["PASS", "COACHING_REQUIRED", "ESCALATED"]),
  summary: z.string().trim().min(10).max(2000),
  coachingAction: z.preprocess((value) => value === "" || value === null ? null : value, z.string().trim().max(2000).nullable()),
  version: z.number().int().min(1).optional(),
}).strict().superRefine((value, context) => {
  if (value.outcome !== "PASS" && !value.coachingAction) context.addIssue({ code: "custom", path: ["coachingAction"], message: "Record the required coaching or escalation action." });
});

export const supportOperatingPolicySchema = z.object({
  timeZone: z.string().trim().min(3).max(80).refine((value) => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } }, "Use a valid IANA timezone such as Asia/Dhaka."),
  firstResponseBusinessDays: z.number().int().min(1).max(10),
  approachingHours: z.number().int().min(1).max(168),
  businessWeekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).transform((days) => [...new Set(days)].sort()),
  openingMinute: z.number().int().min(0).max(1439),
  closingMinute: z.number().int().min(1).max(1440),
  requireScheduledShift: z.boolean(),
  version: z.number().int().min(1).optional(),
}).strict().superRefine((value, context) => { if (value.closingMinute <= value.openingMinute) context.addIssue({ code: "custom", path: ["closingMinute"], message: "Closing time must be after opening time." }); });

export const supportHolidaySchema = z.object({ date: z.string().date(), name: z.string().trim().min(2).max(120) }).strict();

export const supportShiftSchema = z.object({
  agentId: z.string().uuid(),
  startsAt: z.string().datetime({ offset: true }).transform((value) => new Date(value)),
  endsAt: z.string().datetime({ offset: true }).transform((value) => new Date(value)),
  note: z.preprocess((value) => value === "" || value === null ? null : value, z.string().trim().max(240).nullable()),
}).strict().superRefine((value, context) => { if (value.endsAt <= value.startsAt) context.addIssue({ code: "custom", path: ["endsAt"], message: "Shift end must be after shift start." }); if (value.endsAt.getTime() - value.startsAt.getTime() > 24 * 60 * 60 * 1000) context.addIssue({ code: "custom", path: ["endsAt"], message: "A shift cannot exceed 24 hours." }); });

export const supportSatisfactionSchema = z.object({
  score: z.number().int().min(1).max(5),
  issueResolved: z.boolean(),
  comment: z.preprocess(
    (value) => value === "" || value === null ? null : value,
    z.string().trim().max(2000).nullable(),
  ),
}).strict().superRefine((value, context) => {
  if ((value.score <= 2 || !value.issueResolved) && (!value.comment || value.comment.length < 10)) {
    context.addIssue({
      code: "custom",
      path: ["comment"],
      message: "Please briefly explain what went wrong so our support lead can follow up.",
    });
  }
});
