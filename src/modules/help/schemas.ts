import { z } from "zod";

const slug = z.string().trim().toLowerCase().min(2).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and single hyphens.");
const optionalText = (max: number) => z.preprocess((value) => value === "" || value === null ? null : value, z.string().trim().max(max).nullable());
const keywords = z.array(z.string().trim().min(2).max(40)).max(20).transform((values) => [...new Set(values.map((value) => value.toLowerCase()))]);

export const helpCategoryCreateSchema = z.object({
  slug,
  nameEn: z.string().trim().min(2).max(120),
  nameBn: optionalText(120),
  descriptionEn: optionalText(400),
  descriptionBn: optionalText(400),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
}).strict();

export const helpCategoryUpdateSchema = z.object({
  nameEn: z.string().trim().min(2).max(120).optional(),
  nameBn: optionalText(120).optional(),
  descriptionEn: optionalText(400).optional(),
  descriptionBn: optionalText(400).optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  isActive: z.boolean().optional(),
  version: z.number().int().min(1),
}).strict().refine((value) => Object.keys(value).some((key) => key !== "version"), "Provide at least one category change.");

export const helpArticleCreateSchema = z.object({
  slug,
  categoryId: z.string().uuid(),
  titleEn: z.string().trim().min(5).max(180),
  titleBn: optionalText(180),
  summaryEn: z.string().trim().min(10).max(500),
  summaryBn: optionalText(500),
  bodyEn: z.string().trim().min(20).max(20_000),
  bodyBn: optionalText(20_000),
  keywords: keywords.default([]),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
}).strict();

export const helpArticleUpdateSchema = z.object({
  categoryId: z.string().uuid().optional(),
  titleEn: z.string().trim().min(5).max(180).optional(),
  titleBn: optionalText(180).optional(),
  summaryEn: z.string().trim().min(10).max(500).optional(),
  summaryBn: optionalText(500).optional(),
  bodyEn: z.string().trim().min(20).max(20_000).optional(),
  bodyBn: optionalText(20_000).optional(),
  keywords: keywords.optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  isFeatured: z.boolean().optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(),
  version: z.number().int().min(1),
}).strict().refine((value) => Object.keys(value).some((key) => key !== "version"), "Provide at least one article change.");

export const publicHelpSearchSchema = z.object({
  q: z.string().trim().max(100).optional(),
  category: slug.optional(),
  locale: z.enum(["en", "bn"]).default("en"),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(1_000).default(0),
}).strict();
