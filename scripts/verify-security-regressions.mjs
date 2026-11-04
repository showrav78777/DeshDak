import assert from "node:assert/strict";
import { safeInternalPath } from "../src/lib/safe-navigation.ts";
import { trustedClientIp } from "../src/lib/trusted-client-ip.ts";

for (const safe of ["/cart", "/products?q=laptop", "/orders/ORD-123#timeline"]) {
  const normalized = safeInternalPath(safe);
  assert.equal(new URL(normalized, "https://crossly.example").origin, "https://crossly.example");
  assert.equal(normalized, safe);
}
for (const unsafe of ["https://evil.example", "//evil.example", "/\\evil.example", "/%5cevil.example", "/%2f%2fevil.example", "javascript:alert(1)", "\u0000/cart"]) {
  assert.equal(safeInternalPath(unsafe), "/dashboard", `Unsafe post-login path was accepted: ${JSON.stringify(unsafe)}`);
}

const original = {
  NODE_ENV: process.env.NODE_ENV,
  TRUSTED_CLIENT_IP_HEADER: process.env.TRUSTED_CLIENT_IP_HEADER,
  TRUSTED_PROXY_SHARED_SECRET: process.env.TRUSTED_PROXY_SHARED_SECRET,
};
const proxySecret = "proxy-proof-" + "p".repeat(48);
try {
  process.env.NODE_ENV = "production";
  process.env.TRUSTED_CLIENT_IP_HEADER = "x-forwarded-for";
  process.env.TRUSTED_PROXY_SHARED_SECRET = proxySecret;
  assert.equal(trustedClientIp(new Request("https://crossly.example", { headers: { "x-forwarded-for": "203.0.113.10, 10.0.0.2", "x-crossly-proxy-secret": proxySecret } })), "203.0.113.10");
  assert.equal(trustedClientIp(new Request("https://crossly.example", { headers: { "x-forwarded-for": "198.51.100.44" } })), "unknown", "A spoofed forwarding header was trusted without proxy proof.");
  assert.equal(trustedClientIp(new Request("https://crossly.example", { headers: { "x-forwarded-for": "198.51.100.44", "x-crossly-proxy-secret": "wrong" } })), "unknown", "Incorrect proxy proof was accepted.");
  assert.equal(trustedClientIp(new Request("https://crossly.example", { headers: { "x-forwarded-for": "not-an-ip", "x-crossly-proxy-secret": proxySecret } })), "unknown", "Malformed client IP was accepted.");
  delete process.env.TRUSTED_CLIENT_IP_HEADER;
  delete process.env.TRUSTED_PROXY_SHARED_SECRET;
  assert.equal(trustedClientIp(new Request("https://crossly.example", { headers: { "x-forwarded-for": "198.51.100.44" } })), "unknown", "Production trusted an unconfigured forwarding header.");

  process.env.NODE_ENV = "development";
  assert.equal(trustedClientIp(new Request("http://localhost", { headers: { "x-forwarded-for": "192.0.2.9" } })), "192.0.2.9", "Local verification fallback stopped working.");
} finally {
  for (const [name, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

console.log("Security regression checks passed: post-login redirects stay same-origin and forwarded IPs require authenticated ingress proof in production.");
