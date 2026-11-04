import { z } from "zod";

export const sellerStoreProfileSchema = z.object({
  businessName: z.string().trim().min(2).max(160),
  storeDescription: z.string().trim().min(20).max(1000),
  processingDays: z.coerce.number().int().min(1).max(30),
});

export type SellerStoreProfileInput = z.infer<typeof sellerStoreProfileSchema>;
