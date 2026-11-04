import { z } from "zod";

// Internal mapped contract, NOT an assumed schema for any upstream provider.
const plainText = (maximum: number) => z.string().trim().min(1).max(maximum)
  .refine((value) => !/[<>\u0000-\u001f\u007f]/u.test(value));
const candidateSchema = z.object({
  externalProductId: plainText(200),
  originalTitle: plainText(500),
  originalDescription: plainText(10_000).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  // Preserve supplier decimal values. FX and public sale pricing happen elsewhere.
  originalPrice: z.string().regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/)
    .refine((value) => /[1-9]/.test(value)),
  imageUrls: z.array(z.string().max(2048)).max(20),
  inventoryQuantity: z.number().int().min(0).max(1_000_000_000).nullable(),
  declaredWeightGrams: z.number().int().positive().max(1_000_000_000).nullable(),
  dimensionsMm: z.object({
    length: z.number().int().positive().max(1_000_000),
    width: z.number().int().positive().max(1_000_000),
    height: z.number().int().positive().max(1_000_000),
  }).strict().nullable(),
}).strict();

export class SupplierCandidateError extends Error {
  constructor() {
    // Never include raw values, supplier identifiers or validation issues.
    super("Supplier product candidate failed validation");
    this.name = "SupplierCandidateError";
  }
}

type CandidatePolicy = {
  allowedImageHosts: readonly string[];
  allowedCurrencies: readonly string[];
};

/** Validate an explicitly mapped candidate before moderation, never auto-publish. */
export function validateSupplierCandidate(input: unknown, policy: CandidatePolicy) {
  const parsed = candidateSchema.safeParse(input);
  if (!parsed.success || !policy.allowedCurrencies.includes(parsed.data.currency)) throw new SupplierCandidateError();
  const candidate = parsed.data;
  const imageUrls = candidate.imageUrls.map((raw) => {
    try {
      const url = new URL(raw);
      // Exact approved DNS hosts only; no credentials, wildcards, local/IP hosts,
      // fragments or nonstandard ports. This validation never fetches the image.
      const host = url.hostname.toLowerCase();
      if (url.protocol !== "https:" || url.username || url.password || url.hash || url.port ||
          !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) ||
          host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") ||
          !policy.allowedImageHosts.includes(host)) throw new SupplierCandidateError();
      return url.href;
    } catch {
      throw new SupplierCandidateError();
    }
  });
  return {
    ...candidate,
    imageUrls: [...new Set(imageUrls)],
    stockConfirmed: candidate.inventoryQuantity !== null && candidate.inventoryQuantity > 0,
    reviewStatus: "PENDING" as const,
    publishable: false as const,
  };
}
