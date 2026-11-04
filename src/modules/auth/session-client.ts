import "server-only";

import { hashRateLimitKey } from "@/lib/security-secrets";
import { requestIp } from "@/modules/auth/rate-limit";

function operatingSystem(userAgent: string) {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "iOS";
  if (/Android/i.test(userAgent)) return "Android";
  if (/Windows/i.test(userAgent)) return "Windows";
  if (/Macintosh|Mac OS X/i.test(userAgent)) return "macOS";
  if (/Linux/i.test(userAgent)) return "Linux";
  return "Unknown OS";
}

function client(userAgent: string) {
  if (/DUARFlutter|Dart/i.test(userAgent)) return "DeshDak mobile app";
  if (/Edg\//i.test(userAgent)) return "Microsoft Edge";
  if (/OPR\//i.test(userAgent)) return "Opera";
  if (/Chrome\//i.test(userAgent) && !/Chromium/i.test(userAgent)) return "Google Chrome";
  if (/Firefox\//i.test(userAgent)) return "Mozilla Firefox";
  if (/Safari\//i.test(userAgent) && !/Chrome|Chromium/i.test(userAgent)) return "Safari";
  return "Web browser";
}

export function sessionClientDetails(request: Request) {
  const userAgent = (request.headers.get("user-agent") ?? "unknown").slice(0, 512);
  const ip = requestIp(request);
  const clientName = `${client(userAgent)} on ${operatingSystem(userAgent)}`;
  const clientType = /DUARFlutter|Dart/i.test(userAgent) ? "MOBILE_APP" : /Mobile|Android|iPhone|iPad/i.test(userAgent) ? "MOBILE_WEB" : "WEB";
  return {
    clientName,
    clientType,
    userAgentHash: hashRateLimitKey("auth-session-user-agent", userAgent),
    ipHash: ip === "unknown" ? null : hashRateLimitKey("auth-session-ip", ip),
  };
}
