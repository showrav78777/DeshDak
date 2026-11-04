import { z } from "zod";

export const addressSchema = z.object({
  label: z.string().trim().min(2).max(50).default("Delivery address"),
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(8).max(24),
  addressLine1: z.string().trim().min(5).max(250),
  addressLine2: z.string().trim().max(250).optional(),
  city: z.string().trim().min(2).max(100),
  district: z.string().trim().min(2).max(100),
  postalCode: z.string().trim().max(20).optional(),
  countryCode: z.string().trim().length(2).toUpperCase().default("BD"),
});
