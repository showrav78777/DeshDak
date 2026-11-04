import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { verifyHuman } from "@/lib/human-verification";
import { consumeIdentityRequestLimit } from "@/modules/auth/rate-limit";
import { issueSecurityToken } from "@/modules/auth/security-token-service";

const schema = z.object({ email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()), humanVerificationToken: z.string().max(2048).optional(), "cf-turnstile-response": z.string().max(2048).optional() });
const message = "If this address belongs to an account that still needs verification, a new secure link will be emailed shortly.";

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Enter a valid email address.", 422);
  if (!(await verifyHuman(request, parsed.data.humanVerificationToken ?? parsed.data["cf-turnstile-response"], "email_verification_request"))) return apiError("HUMAN_VERIFICATION_FAILED", "Please complete human verification and try again.", 403);
  const limit = await consumeIdentityRequestLimit(request, parsed.data.email, "email-verification-request");
  if (!limit.allowed) { const response = apiError("TOO_MANY_REQUESTS", "Too many verification requests. Please wait before trying again.", 429); response.headers.set("Retry-After", String(limit.retryAfterSeconds)); return response; }
  const user = await prisma.user.findFirst({ where: { email: parsed.data.email, deletedAt: null, status: "PENDING_VERIFICATION" }, select: { id: true, email: true, locale: true } });
  const issued = user ? await prisma.$transaction((tx) => issueSecurityToken(tx, user, "EMAIL_VERIFICATION")) : null;
  const developmentVerificationUrl = process.env.NODE_ENV !== "production" && process.env.ALLOW_DEV_AUTH_LINKS === "true" && issued
    ? `/verify-email#token=${encodeURIComponent(issued.rawToken)}`
    : undefined;
  return apiSuccess({ accepted: true, message, developmentVerificationUrl }, { status: 202, headers: { "Cache-Control": "no-store, max-age=0" } });
}
