import { z } from "zod";

export const productReviewSubmissionSchema = z.object({
  orderItemId: z.string().uuid(),
  rating: z.coerce.number().int().min(1).max(5),
  title: z.string().trim().min(3).max(120).optional(),
  body: z.string().trim().min(10).max(2_000),
});

export const productReviewModerationSchema = z.object({
  decision: z.enum(["PUBLISHED", "REJECTED", "REMOVED"]),
  reason: z.string().trim().max(500).optional(),
  version: z.coerce.number().int().positive(),
}).superRefine((value, context) => {
  if (value.decision !== "PUBLISHED" && (!value.reason || value.reason.length < 5)) context.addIssue({ code: "custom", path: ["reason"], message: "A clear moderation reason is required." });
});
