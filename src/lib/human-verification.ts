import { randomUUID } from "crypto";

type TurnstileResult = { success: boolean; hostname?: string; action?: string; "error-codes"?: string[] };

function getClientIp(request: Request) {
  return request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
}

/**
 * Production is fail-closed. A missing secret, missing token, failed provider call,
 * wrong hostname, or wrong action prevents the protected operation.
 */
export async function verifyHuman(request: Request, token: string | undefined, expectedAction: string) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return process.env.NODE_ENV !== "production";
  if (!token || token.length > 2048) return false;
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, response: token, remoteip: getClientIp(request), idempotency_key: randomUUID() }),
      signal: AbortSignal.timeout(5_000),
    });
    const result = (await response.json()) as TurnstileResult;
    const hostname = process.env.TURNSTILE_EXPECTED_HOSTNAME;
    return response.ok && result.success && (!hostname || result.hostname === hostname) && (!result.action || result.action === expectedAction);
  } catch { return false; }
}
