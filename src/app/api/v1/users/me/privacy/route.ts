import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { recordUserEvent } from "@/modules/activity/service";

const schema = z.object({ analyticsConsent: z.boolean() });

export async function GET(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session) return apiError("AUTHENTICATION_REQUIRED", "Please sign in to view privacy settings.", 401);
  const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { analyticsConsent: true, analyticsConsentAt: true } });
  return apiSuccess({ privacy: user }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function PATCH(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session) return apiError("AUTHENTICATION_REQUIRED", "Please sign in to update privacy settings.", 401);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Choose whether optional activity analytics are allowed.", 422);
  const now = new Date();
  const user = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({ where: { id: session.userId }, data: { analyticsConsent: parsed.data.analyticsConsent, analyticsConsentAt: now }, select: { analyticsConsent: true, analyticsConsentAt: true } });
    await recordUserEvent(tx, { userId: session.userId, authSessionId: session.sessionId, category: "SECURITY", eventType: parsed.data.analyticsConsent ? "ANALYTICS_CONSENT_GRANTED" : "ANALYTICS_CONSENT_WITHDRAWN", objectType: "User", objectId: session.userId });
    await tx.auditLog.create({ data: { actorId: session.userId, action: "privacy.analytics_consent_updated", entityType: "User", entityId: session.userId, metadata: { enabled: parsed.data.analyticsConsent, recordedAt: now.toISOString() } } });
    return updated;
  });
  return apiSuccess({ privacy: user }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
