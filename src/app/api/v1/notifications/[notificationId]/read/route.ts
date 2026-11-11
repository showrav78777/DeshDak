import { type NextRequest } from "next/server";
import { z } from "zod";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";

export async function PATCH(request: NextRequest, context: RouteContext<"/api/v1/notifications/[notificationId]/read">) {
  const session = await getRequestSession(request);
  if (!session) return apiError("AUTHENTICATION_REQUIRED", "Please sign in to update notifications.", 401);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "Update notifications from the protected application.", 403);
  const { notificationId } = await context.params;
  if (!z.uuid().safeParse(notificationId).success) return apiError("VALIDATION_ERROR", "Choose a valid notification.", 422);
  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    await tx.notification.updateMany({ where: { id: notificationId, userId: session.userId, readAt: null }, data: { readAt: now } });
    const notification = await tx.notification.findFirst({ where: { id: notificationId, userId: session.userId }, select: { id: true, readAt: true } });
    if (!notification?.readAt) return null;
    await tx.notificationDelivery.updateMany({ where: { notificationId, channel: "IN_APP", status: "DELIVERED" }, data: { status: "READ", readAt: notification.readAt } });
    return notification;
  });
  if (!updated) return apiError("NOTIFICATION_NOT_FOUND", "Notification was not found.", 404);
  return apiSuccess(updated, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
