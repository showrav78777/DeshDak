import "server-only";
import type { Prisma } from "@prisma/client";
import { z } from "zod";

const safeEvidence = z.string().trim().min(10).max(500).refine(value => !/(?:secret|password|token|api[-_ ]?key|private[-_ ]?key)\s*[:=]/i.test(value), "Record a safe evidence reference, never credentials.");
export const suppressionReviewSchema = z.object({ version: z.number().int().positive(), reason: safeEvidence, evidenceReference: safeEvidence, verificationConfirmed: z.literal(true) }).strict();
export const suppressionQuery = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1), state: z.enum(["active", "released"]).default("active") });
export const suppressionSelect = {
  id: true, reason: true, active: true, version: true, firstSeenAt: true, lastSeenAt: true, releasedAt: true, releaseReason: true, evidenceReference: true,
  sourceDelivery: { select: { id: true, providerReference: true, notification: { select: { user: { select: { fullName: true, personCode: true, email: true } } } } } },
} satisfies Prisma.EmailSuppressionSelect;
