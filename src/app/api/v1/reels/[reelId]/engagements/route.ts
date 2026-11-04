import { Prisma } from "@prisma/client";
import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { trustedClientIp } from "@/lib/trusted-client-ip";
import { consumeSecurityRateLimit } from "@/modules/auth/rate-limit";
import { reelEngagementSchema } from "@/modules/reels/schemas";

export async function POST(request: NextRequest, context: RouteContext<"/api/v1/reels/[reelId]/engagements">) {
  const rate = await consumeSecurityRateLimit("reels:engagement", trustedClientIp(request), 120, 10 * 60_000);
  if (!rate.allowed) return apiError("RATE_LIMITED", "Too many Reel events. Try again later.", 429, { retryAfterSeconds: rate.retryAfterSeconds });
  const parsed = reelEngagementSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "The Reel event is invalid.", 422);
  const { reelId } = await context.params;
  const session = await getRequestSession(request);
  const [reel, viewer] = await Promise.all([
    prisma.reel.findFirst({ where: { id: reelId, status: "ACTIVE", product: { status: "ACTIVE", complianceStatus: "CLEAR", deletedAt: null }, sellerProfile: { status: "APPROVED" }, media: { status: "READY", kind: "VIDEO" } }, select: { id: true } }),
    session ? prisma.user.findUnique({ where: { id: session.userId }, select: { analyticsConsent: true } }) : null,
  ]);
  if (!reel) return apiError("REEL_NOT_FOUND", "Reel not found.", 404);
  const consented = Boolean(session && viewer?.analyticsConsent);
  const complete = parsed.data.type === "VIEW" && parsed.data.completionPercent! >= 90;
  const increment = parsed.data.type === "VIEW"
    ? { viewCount: { increment: 1 }, completedViewCount: { increment: complete ? 1 : 0 }, totalWatchTimeMs: { increment: BigInt(parsed.data.watchTimeMs!) } }
    : parsed.data.type === "SHARE" ? { shareCount: { increment: 1 } } : { productClickCount: { increment: 1 } };
  try {
    await prisma.$transaction(async (tx) => {
      await tx.reelEngagement.create({ data: { idempotencyKey: parsed.data.idempotencyKey, reelId, userId: consented ? session!.userId : null, authSessionId: consented ? session!.sessionId : null, type: parsed.data.type, watchTimeMs: parsed.data.watchTimeMs, durationMs: parsed.data.durationMs, completionPercent: parsed.data.completionPercent } });
      await tx.reel.update({ where: { id: reelId }, data: increment });
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    const existing = await prisma.reelEngagement.findUnique({ where: { idempotencyKey: parsed.data.idempotencyKey }, select: { reelId: true, type: true } });
    if (!existing || existing.reelId !== reelId || existing.type !== parsed.data.type) return apiError("IDEMPOTENCY_KEY_IN_USE", "Use a new Reel event identifier.", 409);
    return apiSuccess({ recorded: false, idempotentReplay: true }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  }
  return apiSuccess({ recorded: true, idempotentReplay: false }, { status: 201, headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
