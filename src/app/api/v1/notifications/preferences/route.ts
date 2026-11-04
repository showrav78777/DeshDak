import { NotificationCategory, NotificationChannel, type Prisma } from "@prisma/client";
import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { notificationPreferenceItems, notificationPreferencePolicy } from "@/modules/notifications/preferences";

const schema = z.object({ category: z.nativeEnum(NotificationCategory), channel: z.nativeEnum(NotificationChannel), enabled: z.boolean(), locale: z.enum(["en", "bn"]).default("en") });

export async function GET(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session) return apiError("AUTHENTICATION_REQUIRED", "Please sign in to view notification preferences.", 401);
  const [saved, user] = await Promise.all([prisma.notificationPreference.findMany({ where: { userId: session.userId } }), prisma.user.findUnique({ where: { id: session.userId }, select: { locale: true } })]);
  const items = notificationPreferenceItems(saved, user?.locale ?? "en");
  return apiSuccess({ items }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function PATCH(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session) return apiError("AUTHENTICATION_REQUIRED", "Please sign in to update notification preferences.", 401);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Choose a valid category, channel, language, and setting.", 422);
  const policy = notificationPreferencePolicy(parsed.data.category, parsed.data.channel);
  if (!policy.available && parsed.data.enabled) return apiError("NOTIFICATION_CHANNEL_UNAVAILABLE", "This notification channel is not connected yet.", 409);
  if (policy.locked && !parsed.data.enabled) return apiError("ESSENTIAL_NOTIFICATION_REQUIRED", "Essential security and transaction notifications cannot be disabled.", 409);
  const preference = await prisma.$transaction(async (tx) => {
    const saved = await tx.notificationPreference.upsert({ where: { userId_category_channel: { userId: session.userId, category: parsed.data.category, channel: parsed.data.channel } }, update: { enabled: parsed.data.enabled, locale: parsed.data.locale }, create: { userId: session.userId, ...parsed.data } });
    await tx.auditLog.create({ data: { actorId: session.userId, action: "notification.preference_updated", entityType: "NotificationPreference", entityId: saved.id, metadata: { category: saved.category, channel: saved.channel, enabled: saved.enabled, locale: saved.locale } as Prisma.InputJsonValue } });
    return saved;
  });
  return apiSuccess({ preference: { category: preference.category, channel: preference.channel, enabled: preference.enabled, locale: preference.locale, ...policy } }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
