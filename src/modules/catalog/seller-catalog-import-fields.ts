export const MAX_IMPORT_ROWS = 100;
export const MAX_IMPORT_COLUMNS = 40;
export const MAX_IMPORT_CELL_CHARACTERS = 3_000;

export const CATALOG_IMPORT_FIELDS = [
  { key: "titleEn", label: "Product name (English)", required: true },
  { key: "titleBn", label: "Product name (Bangla)", required: false },
  { key: "categorySlug", label: "Category slug", required: true },
  { key: "shortDescription", label: "Short description", required: true },
  { key: "description", label: "Full description", required: true },
  { key: "highlights", label: "Highlights (separate with |)", required: true },
  { key: "brand", label: "Brand", required: false },
  { key: "modelNumber", label: "Model number", required: false },
  { key: "sku", label: "Seller SKU", required: false },
  { key: "priceBdt", label: "Price (BDT)", required: true },
  { key: "inventoryQuantity", label: "Available quantity", required: true },
  { key: "stockStatus", label: "Stock status", required: true },
  { key: "weightGrams", label: "Packed weight (g)", required: true },
  { key: "lengthMm", label: "Packed length (mm)", required: true },
  { key: "widthMm", label: "Packed width (mm)", required: true },
  { key: "heightMm", label: "Packed height (mm)", required: true },
  { key: "minimumOrderQuantity", label: "Minimum order quantity", required: true },
  { key: "productionLeadDaysMin", label: "Minimum production days", required: true },
  { key: "productionLeadDaysMax", label: "Maximum production days", required: true },
  { key: "sellingUnit", label: "Selling unit", required: true },
  { key: "packageContents", label: "Package contents", required: true },
  { key: "sampleAvailable", label: "Sample available", required: true },
  { key: "customizationAvailable", label: "Customization available", required: true },
  { key: "returnPolicy", label: "Seller return policy", required: false },
  { key: "warrantyInfo", label: "Warranty information", required: false },
  { key: "hsCode", label: "HS code", required: false },
  { key: "isInternationallyAvailable", label: "International availability", required: true },
] as const;

export type CatalogImportFieldKey = (typeof CATALOG_IMPORT_FIELDS)[number]["key"];
export type CatalogImportMapping = Partial<Record<CatalogImportFieldKey, string>>;
