import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";

export async function PATCH(request: NextRequest, context: RouteContext<"/api/v1/notifications/[notificationId]/read">) {
  const session = await getRequestSession(request);
  if (!session) return apiError("AUTHENTICATION_REQUIRED", "Please sign in to update notifications.", 401);
  const { notificationId } = await context.params;
  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const notification = await tx.notification.updateMany({ where: { id: notificationId, userId: session.userId }, data: { readAt: now } });
    if (notification.count !== 1) return false;
    await tx.notificationDelivery.updateMany({ where: { notificationId, channel: "IN_APP", status: "DELIVERED" }, data: { status: "READ", readAt: now } });
    return true;
  });
  if (!updated) return apiError("NOTIFICATION_NOT_FOUND", "Notification was not found.", 404);
  return apiSuccess({ id: notificationId, readAt: now });
}
