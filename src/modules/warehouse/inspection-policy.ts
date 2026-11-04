import { createHash } from "node:crypto";
import { z } from "zod";

export const inspectionEvidencePattern = /^inspection-evidence\/[0-9a-f-]{36}$/i;
export const packageInspectionSchema = z.object({
  type: z.enum(["BASIC", "PHOTO", "VIDEO"]),
  result: z.enum(["PASSED", "FAILED", "ATTENTION_REQUIRED"]),
  notes: z.string().trim().max(2000).optional(),
  mediaReference: z.string().trim().max(500).optional(),
}).strict().superRefine((value, context) => {
  if (value.result !== "PASSED" && !value.notes) context.addIssue({ code: "custom", path: ["notes"], message: "Notes are required for failed or attention-required inspections." });
  if (value.type !== "BASIC" && (!value.mediaReference || !inspectionEvidencePattern.test(value.mediaReference))) context.addIssue({ code: "custom", path: ["mediaReference"], message: "Photo or video inspection requires an approved evidence reference." });
});

export function inspectionFingerprint(actorId: string, packageId: string, data: z.infer<typeof packageInspectionSchema>) {
  return createHash("sha256").update(JSON.stringify({ actorId, packageId, type: data.type, result: data.result, notes: data.notes || null, mediaReference: data.mediaReference || null })).digest("hex");
}

export const inspectionResponseSelect = { id: true, packageId: true, inspectorId: true, type: true, result: true, notes: true, mediaRefs: true, createdAt: true } as const;
