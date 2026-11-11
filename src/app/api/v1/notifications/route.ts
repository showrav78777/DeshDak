import { type NextRequest } from "next/server";
import { z } from "zod";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";

const querySchema = z.object({ cursor: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(50).default(20), unreadOnly: z.enum(["true", "false"]).optional() });

export async function GET(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session) return apiError("AUTHENTICATION_REQUIRED", "Please sign in to view notifications.", 401);
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({ cursor: url.searchParams.get("cursor") || undefined, limit: url.searchParams.get("limit") || undefined, unreadOnly: url.searchParams.get("unreadOnly") || undefined });
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Check the notification filters.", 422);
  const notifications = await prisma.notification.findMany({
    where: { userId: session.userId, ...(parsed.data.unreadOnly === "true" ? { readAt: null } : {}) },
    select: { id: true, eventType: true, category: true, priority: true, title: true, body: true, titleBn: true, bodyBn: true, deepLink: true, entityType: true, entityId: true, readAt: true, createdAt: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...(parsed.data.cursor ? { cursor: { id: parsed.data.cursor }, skip: 1 } : {}),
    take: parsed.data.limit + 1,
  });
  const hasMore = notifications.length > parsed.data.limit;
  const items = notifications.slice(0, parsed.data.limit);
  const unreadCount = await prisma.notification.count({ where: { userId: session.userId, readAt: null } });
  return apiSuccess({ items, unreadCount, nextCursor: hasMore ? items.at(-1)?.id ?? null : null }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function PATCH(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session) return apiError("AUTHENTICATION_REQUIRED", "Please sign in to update notifications.", 401);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "Update notifications from the protected application.", 403);
  const parsed = z.object({ action: z.literal("MARK_ALL_READ") }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Choose a valid notification action.", 422);
  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.notification.updateMany({ where: { userId: session.userId, readAt: null }, data: { readAt: now } });
    await tx.notificationDelivery.updateMany({ where: { notification: { userId: session.userId, readAt: { not: null } }, channel: "IN_APP", status: "DELIVERED" }, data: { status: "READ", readAt: now } });
    return result.count;
  });
  return apiSuccess({ updated }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
