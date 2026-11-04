import assert from "node:assert/strict";
import { validateProductionEnvironment } from "./lib/production-config.mjs";

const key = (byte) => Buffer.alloc(32, byte).toString("base64");
const valid = {
  DATABASE_URL: "postgresql://crossly:strong-password@prod-db.internal.crossly.net:5432/crossly?sslmode=require",
  APP_BASE_URL: "https://crossly.example",
  AUTH_ISSUER: "https://crossly.example",
  AUTH_SECRET: "auth-" + "a".repeat(64),
  AUTH_OUTBOX_ENCRYPTION_KEY: key(1),
  MFA_ENCRYPTION_KEY: key(2),
  MAINTENANCE_JOB_SECRET: "maintenance-" + "m".repeat(64),
  TRUSTED_CLIENT_IP_HEADER: "x-forwarded-for",
  TRUSTED_PROXY_SHARED_SECRET: "proxy-proof-" + "p".repeat(64),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "turnstile-site-key",
  TURNSTILE_SECRET_KEY: "turnstile-secret-key",
  TURNSTILE_EXPECTED_HOSTNAME: "crossly.example",
  PAYMENT_ADAPTERS_ENABLED: "",
};

assert.deepEqual(validateProductionEnvironment(valid), { ok: true, errors: [] });
const scanToken="scanner-"+"s".repeat(64);
assert.deepEqual(validateProductionEnvironment({...valid,WEBSITE_MEDIA_SCAN_URL:"https://scan.internal/scan",WEBSITE_MEDIA_SCAN_TOKEN:scanToken}),{ok:true,errors:[]});
for(const settings of [
  {WEBSITE_MEDIA_SCAN_URL:"https://scan.internal/scan"},
  {WEBSITE_MEDIA_SCAN_TOKEN:scanToken},
  {WEBSITE_MEDIA_SCAN_URL:"http://scan.internal/scan",WEBSITE_MEDIA_SCAN_TOKEN:scanToken},
  {WEBSITE_MEDIA_SCAN_URL:"https://user:password@scan.internal/scan",WEBSITE_MEDIA_SCAN_TOKEN:scanToken},
  {WEBSITE_MEDIA_SCAN_URL:"https://scan.internal/scan?key=private-value",WEBSITE_MEDIA_SCAN_TOKEN:scanToken},
  {WEBSITE_MEDIA_SCAN_URL:"https://scan.internal/scan",WEBSITE_MEDIA_SCAN_TOKEN:"short"},
  {WEBSITE_MEDIA_SCAN_URL:"https://scan.internal/scan",WEBSITE_MEDIA_SCAN_TOKEN:valid.AUTH_SECRET},
]){
  const result=validateProductionEnvironment({...valid,...settings});
  assert.equal(result.ok,false,"Unsafe or incomplete scanner configuration was accepted.");
  const text=JSON.stringify(result.errors);
  for(const secret of [scanToken,"private-value","user:password"])assert(!text.includes(secret),"Scanner validation exposed a credential.");
}
assert.deepEqual(validateProductionEnvironment({
  ...valid,
  SSLCOMMERZ_STORE_ID: "merchant-store",
  SSLCOMMERZ_STORE_PASSWORD: "merchant-password-from-secret-manager",
  SSLCOMMERZ_ENVIRONMENT: "sandbox",
}), { ok: true, errors: [] });

const incompleteSslCommerz = validateProductionEnvironment({
  ...valid,
  SSLCOMMERZ_STORE_ID: "merchant-store",
  SSLCOMMERZ_ENVIRONMENT: "unknown",
});
assert.equal(incompleteSslCommerz.ok, false);
assert(incompleteSslCommerz.errors.some((error) => error.includes("SSLCOMMERZ_STORE_ID and SSLCOMMERZ_STORE_PASSWORD")));
assert(incompleteSslCommerz.errors.some((error) => error.includes("SSLCOMMERZ_ENVIRONMENT")));

const missing = validateProductionEnvironment({});
assert.equal(missing.ok, false);
for (const name of ["DATABASE_URL", "APP_BASE_URL", "AUTH_ISSUER", "AUTH_SECRET", "AUTH_OUTBOX_ENCRYPTION_KEY", "MFA_ENCRYPTION_KEY", "MAINTENANCE_JOB_SECRET", "TRUSTED_CLIENT_IP_HEADER", "TRUSTED_PROXY_SHARED_SECRET", "TURNSTILE_SECRET_KEY"]) {
  assert(missing.errors.some((error) => error.includes(name)), `${name} was not enforced.`);
}

const unsafe = validateProductionEnvironment({
  ...valid,
  DATABASE_URL: "postgresql://crossly:crossly_dev_password@localhost:5432/crossly",
  APP_BASE_URL: "http://localhost:3000/path?token=not-for-output",
  AUTH_ISSUER: "https://another.example",
  AUTH_SECRET: "change-me",
  MFA_ENCRYPTION_KEY: valid.AUTH_OUTBOX_ENCRYPTION_KEY,
  TURNSTILE_EXPECTED_HOSTNAME: "wrong.example",
  PUBLIC_MEDIA_BASE_URL: "http://localhost:9000/media",
  GOOGLE_CLIENT_ID: "configured-without-secret",
  PAYMENT_ADAPTERS_ENABLED: "BKASH",
});
assert.equal(unsafe.ok, false);
for (const expected of ["local database", "HTTPS", "must not include a path", "AUTH_ISSUER", "placeholder", "independent", "TURNSTILE_EXPECTED_HOSTNAME", "PUBLIC_MEDIA_BASE_URL", "configured together", "PAYMENT_ADAPTERS_ENABLED"]) {
  assert(unsafe.errors.some((error) => error.includes(expected)), `Missing rejection for ${expected}.`);
}

const serializedErrors = JSON.stringify(unsafe.errors);
for (const secret of [unsafe.AUTH_SECRET, unsafe.AUTH_OUTBOX_ENCRYPTION_KEY, unsafe.MAINTENANCE_JOB_SECRET, "not-for-output"]) {
  assert(!serializedErrors.includes(secret), "Validation errors exposed a secret value.");
}

console.log("Production configuration regression checks passed.");
