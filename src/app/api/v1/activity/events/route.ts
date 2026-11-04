import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { recordUserEvent, safeActivityPath } from "@/modules/activity/service";

const schema = z.object({
  eventType: z.enum(["PRODUCT_VIEW", "CATALOG_SEARCH", "CATEGORY_VIEW"]),
  objectId: z.string().trim().max(160).optional(),
  path: z.string().trim().max(500).optional(),
  resultCount: z.number().int().min(0).max(100000).optional(),
  idempotencyKey: z.string().uuid(),
});

const objectTypes = { PRODUCT_VIEW: "Product", CATALOG_SEARCH: "Catalog", CATEGORY_VIEW: "Category" } as const;

export async function POST(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session) return apiError("AUTHENTICATION_REQUIRED", "Sign in before recording account activity.", 401);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "The activity event is invalid.", 422);
  const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { analyticsConsent: true } });
  if (!user?.analyticsConsent) return apiSuccess({ recorded: false, reason: "ANALYTICS_CONSENT_REQUIRED" });
  const duplicate = await prisma.userEvent.findUnique({ where: { idempotencyKey: parsed.data.idempotencyKey }, select: { userId: true } });
  if (duplicate) return duplicate.userId === session.userId ? apiSuccess({ recorded: false, reason: "DUPLICATE" }) : apiError("IDEMPOTENCY_KEY_IN_USE", "Use a new activity event identifier.", 409);
  await prisma.$transaction(async (tx) => {
    await recordUserEvent(tx, {
      idempotencyKey: parsed.data.idempotencyKey,
      userId: session.userId,
      authSessionId: session.sessionId,
      category: "BEHAVIORAL",
      eventType: parsed.data.eventType,
      objectType: objectTypes[parsed.data.eventType],
      objectId: parsed.data.objectId,
      source: "WEB",
      path: safeActivityPath(parsed.data.path),
      metadata: parsed.data.resultCount === undefined ? undefined : { resultCount: parsed.data.resultCount },
    });
  });
  return apiSuccess({ recorded: true }, { status: 201, headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
