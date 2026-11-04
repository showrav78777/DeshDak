import "server-only";

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { hashRateLimitKey } from "@/lib/security-secrets";
import { trustedClientIp } from "@/lib/trusted-client-ip";

export function requestIp(request: Request) {
  return trustedClientIp(request);
}

export async function consumeSecurityRateLimit(scope: string, rawKey: string, limit: number, windowMs: number) {
  if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(windowMs) || windowMs < 1) throw new Error("Rate-limit settings must be positive integers.");
  const keyHash = hashRateLimitKey(scope, rawKey);
  const now = new Date();
  const windowExpiredAt = new Date(now.getTime() - windowMs);
  const newBlockedUntil = new Date(now.getTime() + windowMs);
  const rows = await prisma.$queryRaw<{ attempts: number; blockedUntil: Date | null }[]>`
    INSERT INTO "SecurityRateLimit" AS current
      ("id", "scope", "keyHash", "attempts", "windowStartedAt", "blockedUntil", "createdAt", "updatedAt")
    VALUES
      (${randomUUID()}, ${scope}, ${keyHash}, 1, ${now}, NULL, ${now}, ${now})
    ON CONFLICT ("scope", "keyHash") DO UPDATE SET
      "attempts" = CASE
        WHEN current."blockedUntil" > ${now} THEN current."attempts"
        WHEN current."windowStartedAt" <= ${windowExpiredAt} THEN 1
        ELSE current."attempts" + 1
      END,
      "windowStartedAt" = CASE
        WHEN current."blockedUntil" <= ${now} AND current."windowStartedAt" <= ${windowExpiredAt} THEN ${now}
        WHEN current."blockedUntil" IS NULL AND current."windowStartedAt" <= ${windowExpiredAt} THEN ${now}
        ELSE current."windowStartedAt"
      END,
      "blockedUntil" = CASE
        WHEN current."blockedUntil" > ${now} THEN current."blockedUntil"
        WHEN current."windowStartedAt" <= ${windowExpiredAt} THEN NULL
        WHEN current."attempts" + 1 > ${limit} THEN ${newBlockedUntil}
        ELSE NULL
      END,
      "updatedAt" = CASE WHEN current."blockedUntil" > ${now} THEN current."updatedAt" ELSE ${now} END
    RETURNING "attempts", "blockedUntil"
  `;
  const result = rows[0];
  if (!result) throw new Error("Rate-limit counter did not return a result.");
  const denied = Boolean(result.blockedUntil && result.blockedUntil > now);
  return denied
    ? { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((result.blockedUntil!.getTime() - now.getTime()) / 1000)) }
    : { allowed: true, remaining: Math.max(0, limit - result.attempts), retryAfterSeconds: 0 };
}

export async function consumeIdentityRequestLimit(request: Request, email: string, action: string) {
  const ip = requestIp(request);
  const ipLimit = await consumeSecurityRateLimit(`${action}:ip`, ip, 20, 60 * 60_000);
  const accountLimit = await consumeSecurityRateLimit(`${action}:account`, email, 5, 60 * 60_000);
  return ipLimit.allowed && accountLimit.allowed ? { allowed: true, retryAfterSeconds: 0 } : { allowed: false, retryAfterSeconds: Math.max(ipLimit.retryAfterSeconds, accountLimit.retryAfterSeconds) };
}

export async function consumeConfirmationLimit(request: Request, action: string) {
  return consumeSecurityRateLimit(`${action}:ip`, requestIp(request), 10, 15 * 60_000);
}

export async function consumeLoginLimit(request: Request, email: string) {
  const ip = requestIp(request);
  const ipLimit = await consumeSecurityRateLimit("login:ip", ip, 50, 15 * 60_000);
  const accountLimit = await consumeSecurityRateLimit("login:account", email, 10, 15 * 60_000);
  return ipLimit.allowed && accountLimit.allowed ? { allowed: true, retryAfterSeconds: 0 } : { allowed: false, retryAfterSeconds: Math.max(ipLimit.retryAfterSeconds, accountLimit.retryAfterSeconds) };
}

export async function clearLoginAccountLimit(email: string) {
  await prisma.securityRateLimit.deleteMany({ where: { scope: "login:account", keyHash: hashRateLimitKey("login:account", email) } });
}
