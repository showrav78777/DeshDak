import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

const ALLOWED_IP_HEADERS = new Set(["cf-connecting-ip", "x-forwarded-for", "x-real-ip"]);
const PROXY_VERIFICATION_HEADER = "x-crossly-proxy-secret";

function equalSecret(received: string | null, expected: string) {
  if (!received) return false;
  const receivedBytes = Buffer.from(received);
  const expectedBytes = Buffer.from(expected);
  return receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes);
}

function headerIp(request: Request, headerName: string) {
  const raw = request.headers.get(headerName)?.trim();
  if (!raw) return null;
  const candidate = headerName === "x-forwarded-for" ? raw.split(",")[0]?.trim() : raw;
  return candidate && isIP(candidate) ? candidate : null;
}

/**
 * Production accepts a client address only from a configured ingress header
 * authenticated by a proxy-to-origin secret. Missing or invalid proof fails
 * closed to one shared `unknown` bucket rather than trusting caller headers.
 */
export function trustedClientIp(request: Request) {
  const configuredHeader = process.env.TRUSTED_CLIENT_IP_HEADER?.trim().toLowerCase();
  if (configuredHeader) {
    const proxySecret = process.env.TRUSTED_PROXY_SHARED_SECRET;
    if (!ALLOWED_IP_HEADERS.has(configuredHeader) || !proxySecret || !equalSecret(request.headers.get(PROXY_VERIFICATION_HEADER), proxySecret)) return "unknown";
    return headerIp(request, configuredHeader) ?? "unknown";
  }
  if (process.env.NODE_ENV === "production") return "unknown";
  return headerIp(request, "x-forwarded-for") ?? headerIp(request, "x-real-ip") ?? "unknown";
}
