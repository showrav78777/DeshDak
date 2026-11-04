const configurations = {
  BKASH: { environmentKey: "BKASH_APP_KEY", displayName: "bKash" },
  NAGAD: { environmentKey: "NAGAD_MERCHANT_ID", displayName: "Nagad" },
  SSLCOMMERZ: { environmentKey: "SSLCOMMERZ_STORE_ID", displayName: "SSLCommerz" },
} as const;

export type PaymentAdapterCode = keyof typeof configurations;

export function getPaymentAdapterDefinition(adapterCode: string) {
  return adapterCode in configurations ? configurations[adapterCode as PaymentAdapterCode] : null;
}

export function isPaymentProviderConfigured(adapterCode: string) {
  const configuration = getPaymentAdapterDefinition(adapterCode);
  const explicitlyEnabled = new Set((process.env.PAYMENT_ADAPTERS_ENABLED ?? "").split(",").map((value) => value.trim().toUpperCase()).filter(Boolean));
  const sslCommerzReady = adapterCode !== "SSLCOMMERZ" || Boolean(
    process.env.SSLCOMMERZ_STORE_PASSWORD
      && new Set(["sandbox", "live"]).has((process.env.SSLCOMMERZ_ENVIRONMENT ?? "").trim().toLowerCase()),
  );
  return Boolean(configuration && process.env[configuration.environmentKey] && sslCommerzReady && explicitlyEnabled.has(adapterCode));
}

export function getPaymentAdapterOptions() {
  return Object.entries(configurations).map(([code, configuration]) => ({ code, displayName: configuration.displayName, runtimeConfigured: isPaymentProviderConfigured(code), credentialPresent: Boolean(process.env[configuration.environmentKey]) }));
}
