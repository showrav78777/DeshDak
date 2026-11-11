// Shared server/startup validation. Errors contain field names, never supplied values.
export function validatePrivatePhotoRescanEnvironment(env) {
  const errors = [];
  const flag = env.PRIVATE_PHOTO_RESCAN_ENABLED;
  if (flag !== undefined && !["", "false", "true"].includes(flag)) errors.push("PRIVATE_PHOTO_RESCAN_ENABLED must be true or false.");
  if (flag !== "true") return { ok: errors.length === 0, enabled: false, errors, configuration: null };
  const names = ["PRIVATE_PHOTO_STORAGE_BUCKET", "PRIVATE_PHOTO_STORAGE_REGION", "PRIVATE_PHOTO_STORAGE_EXPECTED_OWNER", "PRIVATE_PHOTO_STORAGE_KMS_KEY_ARN", "PRIVATE_PHOTO_SCANNER_URL", "PRIVATE_PHOTO_SCANNER_TOKEN", "KYC_DOCUMENT_ENCRYPTION_KEY", "INSPECTION_EVIDENCE_ENCRYPTION_KEY"];
  for (const name of names) if (typeof env[name] !== "string" || !env[name] || env[name] !== env[name].trim()) errors.push(`${name} is required without surrounding whitespace.`);
  const bucket = env.PRIVATE_PHOTO_STORAGE_BUCKET ?? "", region = env.PRIVATE_PHOTO_STORAGE_REGION ?? "", owner = env.PRIVATE_PHOTO_STORAGE_EXPECTED_OWNER ?? "", kms = env.PRIVATE_PHOTO_STORAGE_KMS_KEY_ARN ?? "";
  if (bucket.length < 3 || bucket.length > 63 || !/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(bucket) || bucket.includes("..") || /^\d+\.\d+\.\d+\.\d+$/.test(bucket) || bucket.startsWith("xn--") || bucket.endsWith("-s3alias")) errors.push("PRIVATE_PHOTO_STORAGE_BUCKET must identify an approved private bucket.");
  if (!/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(region)) errors.push("PRIVATE_PHOTO_STORAGE_REGION must be a supported region.");
  if (!/^\d{12}$/.test(owner)) errors.push("PRIVATE_PHOTO_STORAGE_EXPECTED_OWNER must identify the expected account.");
  if (!/^arn:aws:kms:[a-z0-9-]+:\d{12}:key\/[a-f0-9-]{36}$/.test(kms) || kms.split(":")[3] !== region || kms.split(":")[4] !== owner) errors.push("PRIVATE_PHOTO_STORAGE_KMS_KEY_ARN must match the region and expected owner.");
  try {
    const url = new URL(env.PRIVATE_PHOTO_SCANNER_URL);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("Invalid URL");
    if (env.WEBSITE_MEDIA_SCAN_URL && url.origin === new URL(env.WEBSITE_MEDIA_SCAN_URL).origin) errors.push("PRIVATE_PHOTO_SCANNER_URL must use a separate private scanner origin.");
  } catch { errors.push("PRIVATE_PHOTO_SCANNER_URL must be HTTPS without credentials, query or fragment."); }
  const token = env.PRIVATE_PHOTO_SCANNER_TOKEN ?? "";
  if (token.length < 32 || token.length > 256 || /[\s\u0000-\u001f\u007f]/.test(token)) errors.push("PRIVATE_PHOTO_SCANNER_TOKEN must contain 32–256 non-whitespace characters.");
  const otherSecrets = ["AUTH_SECRET", "AUTH_OUTBOX_ENCRYPTION_KEY", "MFA_ENCRYPTION_KEY", "MAINTENANCE_JOB_SECRET", "TRUSTED_PROXY_SHARED_SECRET", "WEBSITE_MEDIA_SCAN_TOKEN", "KYC_DOCUMENT_ENCRYPTION_KEY", "INSPECTION_EVIDENCE_ENCRYPTION_KEY", "DATABASE_URL", "RESEND_API_KEY", "RESEND_WEBHOOK_SECRET", "EMAIL_SUPPRESSION_HASH_KEY", "SSLCOMMERZ_STORE_PASSWORD", "OPENAI_API_KEY", "SMS_PROVIDER_API_KEY", "GOOGLE_CLIENT_SECRET"];
  if (token && otherSecrets.some(name => env[name] === token)) errors.push("PRIVATE_PHOTO_SCANNER_TOKEN must be independent from other server secrets.");
  const keys = [env.KYC_DOCUMENT_ENCRYPTION_KEY ?? "", env.INSPECTION_EVIDENCE_ENCRYPTION_KEY ?? ""];
  for (let index = 0; index < keys.length; index++) if (!/^[A-Za-z0-9+/]{43}=$/.test(keys[index]) || (Buffer.from(keys[index], "base64").length !== 32 || Buffer.from(keys[index], "base64").toString("base64") !== keys[index])) errors.push(`${index ? "INSPECTION_EVIDENCE_ENCRYPTION_KEY" : "KYC_DOCUMENT_ENCRYPTION_KEY"} must be a base64-encoded 32-byte key.`);
  if (keys[0] && keys[0] === keys[1]) errors.push("Private photo encryption keys must be independent.");
  for (const key of keys) if (key && [env.AUTH_OUTBOX_ENCRYPTION_KEY, env.MFA_ENCRYPTION_KEY, env.AUTH_SECRET].includes(key)) errors.push("Private photo encryption keys must be independent from authentication keys.");
  const configuration = errors.length ? null : { storage: { bucket, region, expectedOwner: owner, kmsKeyArn: kms }, scanner: { url: env.PRIVATE_PHOTO_SCANNER_URL, token }, keys: { identity: Buffer.from(keys[0], "base64"), inspection: Buffer.from(keys[1], "base64") } };
  return { ok: errors.length === 0, enabled: true, errors, configuration };
}
