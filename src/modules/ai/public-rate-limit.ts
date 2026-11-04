import { type NextRequest } from "next/server";
import { trustedClientIp } from "@/lib/trusted-client-ip";
import { consumeSecurityRateLimit } from "@/modules/auth/rate-limit";

export function checkPublicAiRateLimit(request: NextRequest, capability: string, limit: number, windowMs = 10 * 60 * 1000) {
  return consumeSecurityRateLimit(capability, trustedClientIp(request), limit, windowMs);
}
