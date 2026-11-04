export const DEFAULT_CUSTOMER_COUNTRY = "BD";

export function normalizeMarketCountry(value: string | null | undefined) {
  const normalized = value?.trim().toUpperCase();
  return normalized && /^[A-Z]{2}$/.test(normalized) ? normalized : DEFAULT_CUSTOMER_COUNTRY;
}

export function productMarketPriority(originCountryCode: string, customerCountryCode: string) {
  const origin = originCountryCode.toUpperCase();
  const customer = normalizeMarketCountry(customerCountryCode);
  if (customer === "BD") return origin === "BD" ? 1 : 0;
  return origin === customer ? 0 : 1;
}

export function customerMarketLabel(customerCountryCode: string) {
  return normalizeMarketCountry(customerCountryCode) === "BD" ? "GLOBAL_FIRST" : "LOCAL_FIRST";
}
