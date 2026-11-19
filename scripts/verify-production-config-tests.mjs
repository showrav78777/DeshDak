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
const email = { EMAIL_DELIVERY_ENABLED: "true", RESEND_API_KEY: "mail-" + "r".repeat(40), EMAIL_FROM: "DeshDak <mail@deshdak.invalid>", RESEND_WEBHOOK_SECRET: `whsec_${key(9)}`, EMAIL_SUPPRESSION_HASH_KEY: key(8) };
assert.deepEqual(validateProductionEnvironment({ ...valid, ...email }), { ok: true, errors: [] });
for (const secret of [undefined, "not-a-signing-key", "whsec_c2hvcnQ=", "whsec_%%%%"]) {
  const result = validateProductionEnvironment({ ...valid, ...email, RESEND_WEBHOOK_SECRET: secret });
  assert(!result.ok); assert(result.errors.some(error => error.includes("RESEND_WEBHOOK_SECRET")));
  if (secret) assert(!JSON.stringify(result.errors).includes(`\"${secret}\"`));
}
for (const recipientKey of [undefined, "short", valid.AUTH_OUTBOX_ENCRYPTION_KEY]) assert(!validateProductionEnvironment({ ...valid, ...email, EMAIL_SUPPRESSION_HASH_KEY: recipientKey }).ok);
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


const privateRescan = {
  PRIVATE_PHOTO_RESCAN_ENABLED: "true", PRIVATE_PHOTO_STORAGE_BUCKET: "deshdak-private-media",
  PRIVATE_PHOTO_STORAGE_REGION: "us-east-1", PRIVATE_PHOTO_STORAGE_EXPECTED_OWNER: "123456789012",
  PRIVATE_PHOTO_STORAGE_KMS_KEY_ARN: "arn:aws:kms:us-east-1:123456789012:key/11111111-1111-4111-8111-111111111111",
  PRIVATE_PHOTO_SCANNER_URL: "https://private-scan.internal/scan", PRIVATE_PHOTO_SCANNER_TOKEN: "private-scan-" + "r".repeat(48),
  KYC_DOCUMENT_ENCRYPTION_KEY: key(21), INSPECTION_EVIDENCE_ENCRYPTION_KEY: key(22),
};
assert.deepEqual(validateProductionEnvironment({ ...valid, ...privateRescan }), { ok: true, errors: [] });
for (const invalid of [
  { PRIVATE_PHOTO_RESCAN_ENABLED: "yes" }, { PRIVATE_PHOTO_STORAGE_BUCKET: "" }, { PRIVATE_PHOTO_STORAGE_EXPECTED_OWNER: "987654321098" },
  { PRIVATE_PHOTO_SCANNER_URL: "http://private-scan.internal/scan" }, { PRIVATE_PHOTO_SCANNER_URL: "https://scan.internal/scan?secret=PRIVATE" },
  { PRIVATE_PHOTO_SCANNER_TOKEN: "short" }, { PRIVATE_PHOTO_SCANNER_TOKEN: privateRescan.PRIVATE_PHOTO_SCANNER_TOKEN + "\0" }, { PRIVATE_PHOTO_SCANNER_TOKEN: valid.AUTH_SECRET },
  { WEBSITE_MEDIA_SCAN_URL: privateRescan.PRIVATE_PHOTO_SCANNER_URL, WEBSITE_MEDIA_SCAN_TOKEN: scanToken },
  { INSPECTION_EVIDENCE_ENCRYPTION_KEY: privateRescan.KYC_DOCUMENT_ENCRYPTION_KEY }, { KYC_DOCUMENT_ENCRYPTION_KEY: valid.MFA_ENCRYPTION_KEY },
]) {
  const checked = validateProductionEnvironment({ ...valid, ...privateRescan, ...invalid });
  assert(!checked.ok, "Unsafe private scanner configuration passed startup checks.");
  assert(!JSON.stringify(checked.errors).includes(privateRescan.PRIVATE_PHOTO_SCANNER_TOKEN));
  assert(!JSON.stringify(checked.errors).includes("secret=PRIVATE"));
}
console.log("Private-photo rescan startup checks passed: independent private HTTPS endpoint/token, expected storage owner/KMS, encryption keys and fail-closed activation.");

for (const invalid of [
  { PRIVATE_PHOTO_STORAGE_ENABLED: "yes" },
  { PRIVATE_PHOTO_STORAGE_ENABLED: "true" },
  { ...privateRescan, PRIVATE_PHOTO_STORAGE_ENABLED: "true", PRIVATE_PHOTO_STORAGE_BUCKET: "" },
]) assert(!validateProductionEnvironment({ ...valid, ...invalid }).ok);
assert.deepEqual(validateProductionEnvironment({ ...valid, ...privateRescan, PRIVATE_PHOTO_RESCAN_ENABLED: "false", PRIVATE_PHOTO_STORAGE_ENABLED: "true" }), { ok: true, errors: [] });
console.log("Private photo intake/delivery activation requires the approved storage, private scanner and independent keys.");
