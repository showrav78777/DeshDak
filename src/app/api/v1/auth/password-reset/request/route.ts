import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { verifyHuman } from "@/lib/human-verification";
import { consumeIdentityRequestLimit } from "@/modules/auth/rate-limit";
import { issueSecurityToken } from "@/modules/auth/security-token-service";

const schema = z.object({ email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()), humanVerificationToken: z.string().max(2048).optional(), "cf-turnstile-response": z.string().max(2048).optional() });
const message = "If an eligible account uses this address, a secure password-reset link will be emailed shortly.";

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Enter a valid email address.", 422);
  if (!(await verifyHuman(request, parsed.data.humanVerificationToken ?? parsed.data["cf-turnstile-response"], "password_reset_request"))) return apiError("HUMAN_VERIFICATION_FAILED", "Please complete human verification and try again.", 403);
  const limit = await consumeIdentityRequestLimit(request, parsed.data.email, "password-reset-request");
  if (!limit.allowed) { const response = apiError("TOO_MANY_REQUESTS", "Too many reset requests. Please wait before trying again.", 429); response.headers.set("Retry-After", String(limit.retryAfterSeconds)); return response; }
  const user = await prisma.user.findFirst({ where: { email: parsed.data.email, deletedAt: null }, select: { id: true, email: true, locale: true, roles: { select: { role: { select: { code: true } } } } } });
  const privileged = user?.roles.some(({ role }) => ["admin", "finance", "compliance"].includes(role.code));
  if (user && !privileged) await prisma.$transaction((tx) => issueSecurityToken(tx, user, "PASSWORD_RESET"));
  return apiSuccess({ accepted: true, message }, { status: 202, headers: { "Cache-Control": "no-store, max-age=0" } });
}
