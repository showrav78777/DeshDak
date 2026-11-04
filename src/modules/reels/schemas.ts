import { z } from "zod";

export const reelSubmissionSchema = z.object({
  productId: z.string().uuid(),
  mediaId: z.string().uuid(),
  caption: z.string().trim().min(1).max(500),
});

export const reelSellerUpdateSchema = z.object({
  caption: z.string().trim().min(1).max(500),
  action: z.enum(["SAVE", "RESUBMIT", "ARCHIVE"]),
  version: z.number().int().positive(),
});

export const reelModerationSchema = z.object({
  decision: z.enum(["PUBLISH", "REJECT", "ARCHIVE"]),
  reason: z.string().trim().max(500).optional().default(""),
  version: z.number().int().positive(),
}).superRefine((value, context) => {
  if (value.decision === "REJECT" && value.reason.length < 5) context.addIssue({ code: "custom", path: ["reason"], message: "A rejection reason is required." });
});

export const reelEngagementSchema = z.object({
  type: z.enum(["VIEW", "SHARE", "PRODUCT_CLICK"]),
  idempotencyKey: z.string().uuid(),
  watchTimeMs: z.number().int().min(0).max(3_600_000).optional(),
  durationMs: z.number().int().min(1).max(3_600_000).optional(),
  completionPercent: z.number().int().min(0).max(100).optional(),
}).superRefine((value, context) => {
  if (value.type === "VIEW" && (value.watchTimeMs === undefined || value.durationMs === undefined || value.completionPercent === undefined)) {
    context.addIssue({ code: "custom", path: ["watchTimeMs"], message: "Views require duration, watch time, and completion percentage." });
  }
  if (value.watchTimeMs !== undefined && value.durationMs !== undefined && value.watchTimeMs > value.durationMs * 2) {
    context.addIssue({ code: "custom", path: ["watchTimeMs"], message: "Watch time is outside the accepted range." });
  }
});

export const reelReactionSchema = z.object({
  type: z.enum(["LIKE", "SAVE"]),
  active: z.boolean(),
});

export const reelCommentSchema = z.object({ body: z.string().trim().min(2).max(500) });

export const reelCommentModerationSchema = z.object({
  decision: z.enum(["PUBLISH", "REJECT", "REMOVE"]),
  reason: z.string().trim().max(500).optional().default(""),
  version: z.number().int().positive(),
}).superRefine((value, context) => {
  if (value.decision !== "PUBLISH" && value.reason.length < 5) context.addIssue({ code: "custom", path: ["reason"], message: "A moderation reason is required." });
});
