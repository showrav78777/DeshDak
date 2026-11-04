import { createHash } from "node:crypto";
import { z } from "zod";
import { CATALOG_IMPORT_FIELDS, MAX_IMPORT_CELL_CHARACTERS, MAX_IMPORT_COLUMNS, MAX_IMPORT_ROWS, type CatalogImportFieldKey, type CatalogImportMapping } from "@/modules/catalog/seller-catalog-import-fields";
import { sellerProductInputSchema, type SellerProductInput } from "@/modules/catalog/seller-product-input";

export const IMPORT_PREVIEW_MINUTES = 60;
export type CatalogImportRowResult = { rowNumber: number; status: "VALID" | "INVALID"; sourceData: Record<string, string>; normalizedData: SellerProductInput | null; validationErrors: { field: string; message: string }[]; fingerprint: string };

const cell = z.string().max(MAX_IMPORT_CELL_CHARACTERS).refine((value) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value), "CSV cells cannot contain control characters.").transform((value) => value.trim());
export const catalogImportPreviewSchema = z.object({
  originalFilename: z.string().trim().min(1).max(180).regex(/^[^/\\]+\.csv$/i, "Choose a CSV file."),
  headers: z.array(z.string().trim().min(1).max(100)).min(1).max(MAX_IMPORT_COLUMNS),
  rows: z.array(z.array(cell).min(1).max(MAX_IMPORT_COLUMNS)).min(1).max(MAX_IMPORT_ROWS),
  mapping: z.record(z.string(), z.string().trim().max(100)),
}).strict();

function parseBoolean(value: string) {
  const normalized = value.trim().toLowerCase();
  if (["true", "yes", "y", "1", "on"].includes(normalized)) return true;
  if (["false", "no", "n", "0", "off"].includes(normalized)) return false;
  return null;
}

function fingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function validateImportMapping(headers: string[], rawMapping: Record<string, string>) {
  const headerSet = new Set(headers);
  if (headerSet.size !== headers.length) return { error: "CSV column names must be unique." } as const;
  const allowedKeys = new Set(CATALOG_IMPORT_FIELDS.map((field) => field.key));
  const mapping: CatalogImportMapping = {};
  for (const [key, header] of Object.entries(rawMapping)) {
    if (!allowedKeys.has(key as CatalogImportFieldKey) || !header) continue;
    if (!headerSet.has(header)) return { error: `Mapped column “${header}” does not exist in this CSV.` } as const;
    mapping[key as CatalogImportFieldKey] = header;
  }
  const missing = CATALOG_IMPORT_FIELDS.filter((field) => field.required && !mapping[field.key]).map((field) => field.label);
  if (missing.length) return { error: `Map every required field: ${missing.join(", ")}.` } as const;
  const usedHeaders = Object.values(mapping);
  if (new Set(usedHeaders).size !== usedHeaders.length) return { error: "Each CSV column can map to only one product field." } as const;
  return { mapping } as const;
}

export function createImportFingerprint(headers: string[], rows: string[][], mapping: CatalogImportMapping) {
  return fingerprint({ headers, rows, mapping });
}

export function buildCatalogImportRows(
  headers: string[],
  rows: string[][],
  mapping: CatalogImportMapping,
  categories: { id: string; slug: string }[],
  existingSkus: Set<string>,
) {
  const headerIndexes = new Map(headers.map((header, index) => [header, index]));
  const categoryIds = new Map(categories.map((category) => [category.slug.toLowerCase(), category.id]));
  const batchSkus = new Set<string>();
  return rows.map((row, index): CatalogImportRowResult => {
    const sourceData: Record<string, string> = {};
    for (const field of CATALOG_IMPORT_FIELDS) {
      const header = mapping[field.key];
      sourceData[field.key] = header ? (row[headerIndexes.get(header) ?? -1] ?? "").trim() : "";
    }
    const errors: { field: string; message: string }[] = [];
    for (const [field, value] of Object.entries(sourceData)) {
      if (/^[=+\-@]/.test(value)) errors.push({ field, message: "Spreadsheet formulas are not accepted." });
      if (/<[^>]+>/.test(value)) errors.push({ field, message: "HTML markup is not accepted." });
      if (/\bhttps?:\/\//i.test(value)) errors.push({ field, message: "External URLs are not accepted in catalog imports." });
    }
    const categoryId = categoryIds.get(sourceData.categorySlug.toLowerCase());
    if (!categoryId) errors.push({ field: "categorySlug", message: "Use the slug of an active category." });
    const booleanFields = ["sampleAvailable", "customizationAvailable", "isInternationallyAvailable"] as const;
    const booleans = Object.fromEntries(booleanFields.map((field) => {
      const value = parseBoolean(sourceData[field]);
      if (value === null) errors.push({ field, message: "Use yes/no, true/false, or 1/0." });
      return [field, value];
    }));
    const candidate = {
      ...sourceData,
      categoryId: categoryId ?? sourceData.categorySlug,
      highlights: sourceData.highlights.split("|").map((item) => item.trim()).filter(Boolean),
      sampleAvailable: booleans.sampleAvailable,
      customizationAvailable: booleans.customizationAvailable,
      isInternationallyAvailable: booleans.isInternationallyAvailable,
    };
    const parsed = sellerProductInputSchema.safeParse(candidate);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) errors.push({ field: String(issue.path[0] ?? "row"), message: issue.message });
    }
    const sku = sourceData.sku;
    if (sku && existingSkus.has(sku)) errors.push({ field: "sku", message: "This SKU is already used by another product." });
    if (sku && batchSkus.has(sku)) errors.push({ field: "sku", message: "This SKU appears more than once in this CSV." });
    if (sku) batchSkus.add(sku);
    const uniqueErrors = [...new Map(errors.map((error) => [`${error.field}:${error.message}`, error])).values()];
    const normalizedData = parsed.success && uniqueErrors.length === 0 ? parsed.data : null;
    return { rowNumber: index + 2, status: normalizedData ? "VALID" : "INVALID", sourceData, normalizedData, validationErrors: uniqueErrors, fingerprint: fingerprint(sourceData) };
  });
}
