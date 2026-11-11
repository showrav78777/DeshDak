import { validatePrivatePhotoRescanEnvironment } from "./private-photo-rescan-config.mjs";
const PLACEHOLDER_PATTERN = /(replace[-_ ]?with|change[-_ ]?me|example|crossly_dev_password|your[-_ ]?(secret|key|password)|^test$)/i;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

function configured(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function requireSecret(env, name, errors, minimumLength = 32) {
  const value = env[name]?.trim();
  if (!value) {
    errors.push(`${name} is required.`);
    return null;
  }
  if (value.length < minimumLength) errors.push(`${name} must be at least ${minimumLength} characters.`);
  if (PLACEHOLDER_PATTERN.test(value)) errors.push(`${name} contains a placeholder or development value.`);
  return value;
}

function requireBase64Key(env, name, errors) {
  const value = requireSecret(env, name, errors, 40);
  if (!value) return null;
  const normalized = value.replace(/=+$/, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || Buffer.from(value, "base64").length !== 32 || Buffer.from(value, "base64").toString("base64").replace(/=+$/, "") !== normalized) {
    errors.push(`${name} must be a valid base64-encoded 32-byte key.`);
    return null;
  }
  return value;
}

function requireHttpsOrigin(env, name, errors) {
  const raw = env[name]?.trim();
  if (!raw) {
    errors.push(`${name} is required.`);
    return null;
  }
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") errors.push(`${name} must use HTTPS.`);
    if (LOCAL_HOSTS.has(url.hostname) || url.hostname.endsWith(".localhost")) errors.push(`${name} cannot use a local hostname.`);
    if (url.username || url.password || url.search || url.hash) errors.push(`${name} must be a clean public origin without credentials, query, or fragment.`);
    if (url.pathname !== "/") errors.push(`${name} must not include a path.`);
    return url;
  } catch {
    errors.push(`${name} must be a valid absolute URL.`);
    return null;
  }
}

function validateDatabaseUrl(env, errors) {
  const raw = env.DATABASE_URL?.trim();
  if (!raw) {
    errors.push("DATABASE_URL is required.");
    return;
  }
  try {
    const url = new URL(raw);
    if (!["postgres:", "postgresql:"].includes(url.protocol)) errors.push("DATABASE_URL must use PostgreSQL.");
    if (LOCAL_HOSTS.has(url.hostname) || url.hostname.endsWith(".localhost")) errors.push("DATABASE_URL cannot target a local database in production.");
    if (PLACEHOLDER_PATTERN.test(raw)) errors.push("DATABASE_URL contains a placeholder or development credential.");
  } catch {
    errors.push("DATABASE_URL must be a valid PostgreSQL URL.");
  }
}

function validateOptionalPair(env, first, second, errors) {
  if (configured(env[first]) !== configured(env[second])) errors.push(`${first} and ${second} must be configured together.`);
}

export function validateProductionEnvironment(env) {
  const errors = [];
  validateDatabaseUrl(env, errors);

  const applicationUrl = requireHttpsOrigin(env, "APP_BASE_URL", errors);
  const issuerUrl = requireHttpsOrigin(env, "AUTH_ISSUER", errors);
  if (configured(env.PUBLIC_MEDIA_BASE_URL)) requireHttpsOrigin(env, "PUBLIC_MEDIA_BASE_URL", errors);
  if (applicationUrl && issuerUrl && applicationUrl.origin !== issuerUrl.origin) errors.push("AUTH_ISSUER must match the APP_BASE_URL origin.");

  const authSecret = requireSecret(env, "AUTH_SECRET", errors);
  const outboxKey = requireBase64Key(env, "AUTH_OUTBOX_ENCRYPTION_KEY", errors);
  const mfaKey = requireBase64Key(env, "MFA_ENCRYPTION_KEY", errors);
  const maintenanceSecret = requireSecret(env, "MAINTENANCE_JOB_SECRET", errors);
  const trustedProxySecret = requireSecret(env, "TRUSTED_PROXY_SHARED_SECRET", errors);
  const setupToken = configured(env.INITIAL_ADMIN_SETUP_TOKEN) ? requireSecret(env, "INITIAL_ADMIN_SETUP_TOKEN", errors) : null;

  const distinctSecrets = [authSecret, outboxKey, mfaKey, maintenanceSecret, trustedProxySecret, setupToken].filter(Boolean);
  if (new Set(distinctSecrets).size !== distinctSecrets.length) errors.push("Authentication, encryption, maintenance, proxy, and setup secrets must be independent values.");

  const trustedClientIpHeader = env.TRUSTED_CLIENT_IP_HEADER?.trim().toLowerCase();
  if (!trustedClientIpHeader) errors.push("TRUSTED_CLIENT_IP_HEADER is required.");
  else if (!new Set(["cf-connecting-ip", "x-forwarded-for", "x-real-ip"]).has(trustedClientIpHeader)) errors.push("TRUSTED_CLIENT_IP_HEADER must name an approved ingress-controlled IP header.");

  requireSecret(env, "NEXT_PUBLIC_TURNSTILE_SITE_KEY", errors, 10);
  requireSecret(env, "TURNSTILE_SECRET_KEY", errors, 10);
  const expectedHostname = env.TURNSTILE_EXPECTED_HOSTNAME?.trim().toLowerCase();
  if (!expectedHostname) errors.push("TURNSTILE_EXPECTED_HOSTNAME is required.");
  else if (applicationUrl && expectedHostname !== applicationUrl.hostname.toLowerCase()) errors.push("TURNSTILE_EXPECTED_HOSTNAME must match APP_BASE_URL.");

  validateOptionalPair(env, "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", errors);
  validateOptionalPair(env, "FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET", errors);
  validateOptionalPair(env, "SMS_PROVIDER_API_KEY", "SMS_PROVIDER_SENDER_ID", errors);
  validateOptionalPair(env, "SSLCOMMERZ_STORE_ID", "SSLCOMMERZ_STORE_PASSWORD", errors);
  errors.push(...validatePrivatePhotoRescanEnvironment(env).errors);
  validateOptionalPair(env, "WEBSITE_MEDIA_SCAN_URL", "WEBSITE_MEDIA_SCAN_TOKEN", errors);
  if (configured(env.WEBSITE_MEDIA_SCAN_TOKEN)) {
    const scannerSecret = requireSecret(env, "WEBSITE_MEDIA_SCAN_TOKEN", errors);
    if (scannerSecret && distinctSecrets.includes(scannerSecret)) errors.push("WEBSITE_MEDIA_SCAN_TOKEN must be independent from authentication, encryption, maintenance, proxy and setup secrets.");
  }
  if (configured(env.WEBSITE_MEDIA_SCAN_URL)) {
    try {
      const endpoint = new URL(env.WEBSITE_MEDIA_SCAN_URL.trim());
      if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) errors.push("WEBSITE_MEDIA_SCAN_URL must use HTTPS without credentials, query or fragment.");
    } catch { errors.push("WEBSITE_MEDIA_SCAN_URL must be a valid HTTPS endpoint."); }
  }
  if (env.EMAIL_DELIVERY_ENABLED === "true") {
    requireSecret(env, "RESEND_API_KEY", errors, 20);
    const recipientKey = requireBase64Key(env, "EMAIL_SUPPRESSION_HASH_KEY", errors);
    if (recipientKey && distinctSecrets.includes(recipientKey)) errors.push("EMAIL_SUPPRESSION_HASH_KEY must be independent from authentication, encryption, maintenance and proxy secrets.");
    const sender = env.EMAIL_FROM?.trim();
    if (!sender || !/^[^<>\r\n]+<[^<>\s@]+@[^<>\s@]+>$|^[^<>\s@]+@[^<>\s@]+$/.test(sender)) errors.push("EMAIL_FROM must be a verified sender address, optionally in Name <address> format.");
  } else if (configured(env.RESEND_API_KEY) || configured(env.EMAIL_FROM)) {
    errors.push("EMAIL_DELIVERY_ENABLED must be true when email delivery credentials are configured.");
  }
  if (env.EMAIL_DELIVERY_ENABLED === "true" || configured(env.RESEND_WEBHOOK_SECRET)) {
    const secret = env.RESEND_WEBHOOK_SECRET?.trim() ?? "";
    const encoded = secret.startsWith("whsec_") ? secret.slice(6) : "";
    const bytes = Buffer.from(encoded, "base64");
    if (!/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(secret) || bytes.length < 16 || bytes.length > 64 || bytes.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, "")) errors.push("RESEND_WEBHOOK_SECRET must be a valid whsec_ signing secret when email delivery or callbacks are configured.");
  }
  if (configured(env.SSLCOMMERZ_STORE_ID) || configured(env.SSLCOMMERZ_STORE_PASSWORD)) {
    if (!new Set(["sandbox", "live"]).has(env.SSLCOMMERZ_ENVIRONMENT?.trim().toLowerCase())) {
      errors.push("SSLCOMMERZ_ENVIRONMENT must be sandbox or live when SSLCommerz credentials are configured.");
    }
  }

  const enabledPayments = (env.PAYMENT_ADAPTERS_ENABLED ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (enabledPayments.length > 0) errors.push("PAYMENT_ADAPTERS_ENABLED must remain empty until a real gateway adapter, signed webhook, refund, and reconciliation flow has passed certification.");

  return { ok: errors.length === 0, errors };
}
