import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { acknowledgePhoneOtpInvestigation, phoneOtpInvestigationSchema } from "@/modules/notifications/phone-otp-investigation";

export async function POST(request: NextRequest, context: { params: Promise<{ deliveryId: string }> }) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin" || !session.mfaVerifiedAt) return apiError("ADMIN_MFA_REQUIRED", "Administrator access with completed MFA is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "Investigation must originate from the protected Admin application.", 403);
  const parsed = phoneOtpInvestigationSchema.safeParse(await request.json().catch(() => null));
  const id = z.uuid().safeParse((await context.params).deliveryId);
  if (!parsed.success || !id.success) return apiError("VALIDATION_ERROR", "Confirm that the available references have been reviewed.", 422);
  try {
    const result = await prisma.$transaction(tx => acknowledgePhoneOtpInvestigation(tx, session.userId, session.sessionId, id.data));
    if (result.outcome === "DENIED") return apiError("ADMIN_MFA_REQUIRED", "Your Admin access changed. Sign in again before recording a review.", 403);
    if (result.outcome === "CONFLICT") return apiError("SMS_REVIEW_CONFLICT", "This job is no longer an unconfirmed OTP attempt. Reload its current state.", 409);
    return apiSuccess({ acknowledged: true, replayed: result.replayed }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch { return apiError("SMS_REVIEW_UNAVAILABLE", "The investigation acknowledgement could not be confirmed. Reload before retrying.", 503); }
}
