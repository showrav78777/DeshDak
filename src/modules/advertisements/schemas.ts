import { z } from "zod";

export const advertisementPlacements = ["GLOBAL_BANNER", "ENTRY_POPUP", "HOME_FEED", "PRODUCT_LIST", "PRODUCT_DETAIL", "CART", "REELS"] as const;

function safeDestination(value: string) {
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

export const advertisementCreateSchema = z.object({
  advertiserName: z.string().trim().min(2).max(120),
  title: z.string().trim().min(3).max(160),
  body: z.string().trim().max(500).optional(),
  imageUrl: z.string().trim().url().max(1000).refine((value) => value.startsWith("https://"), "Use an HTTPS image URL.").optional(),
  targetUrl: z.string().trim().max(1000).refine(safeDestination, "Use an internal DeshDak path or HTTPS URL."),
  altText: z.string().trim().max(200).optional(),
  placement: z.enum(advertisementPlacements),
  pagePath: z.string().trim().max(300).refine((value) => value.startsWith("/") && !value.startsWith("//"), "Use a DeshDak page path beginning with /.").optional(),
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED"]).default("DRAFT"),
  displayOrder: z.coerce.number().int().min(0).max(10000).default(0),
  startsAt: z.iso.datetime({ offset: true }).optional(),
  endsAt: z.iso.datetime({ offset: true }).optional(),
  isDismissible: z.boolean().default(true),
}).superRefine((value, context) => {
  if (value.startsAt && value.endsAt && new Date(value.endsAt) <= new Date(value.startsAt)) context.addIssue({ code: "custom", path: ["endsAt"], message: "End time must be after the start time." });
  if (value.imageUrl && !value.altText) context.addIssue({ code: "custom", path: ["altText"], message: "Describe advertisement images for accessibility." });
});

export const advertisementUpdateSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED"]),
  content: advertisementCreateSchema.optional(),
});
