import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { consumeSecurityRateLimit } from "@/modules/auth/rate-limit";
import { reelCommentSchema } from "@/modules/reels/schemas";

export async function GET(request: NextRequest, context: RouteContext<"/api/v1/reels/[reelId]/comments">) {
  const { reelId } = await context.params;
  const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") ?? 1) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(request.nextUrl.searchParams.get("pageSize") ?? 20) || 20));
  const reel = await prisma.reel.findFirst({ where: { id: reelId, status: "ACTIVE" }, select: { id: true } });
  if (!reel) return apiError("REEL_NOT_FOUND", "Reel not found.", 404);
  const where = { reelId, status: "PUBLISHED" as const };
  const [comments, total] = await prisma.$transaction([
    prisma.reelComment.findMany({ where, select: { id: true, body: true, publishedAt: true, author: { select: { fullName: true } } }, orderBy: [{ publishedAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
    prisma.reelComment.count({ where }),
  ]);
  return apiSuccess({ comments, meta: { page, pageSize, total, hasNextPage: page * pageSize < total } }, { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" } });
}

export async function POST(request: NextRequest, context: RouteContext<"/api/v1/reels/[reelId]/comments">) {
  const session = await getRequestSession(request);
  if (!session) return apiError("AUTHENTICATION_REQUIRED", "Sign in to comment on a Reel.", 401);
  if (!session.roles.includes(ROLE.CUSTOMER_PERSONAL)) return apiError("CUSTOMER_ACCESS_REQUIRED", "A customer account is required.", 403);
  const rate = await consumeSecurityRateLimit("reels:comment", session.userId, 10, 60 * 60_000);
  if (!rate.allowed) return apiError("RATE_LIMITED", "Too many comments. Try again later.", 429, { retryAfterSeconds: rate.retryAfterSeconds });
  const parsed = reelCommentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Comment must contain 2 to 500 characters.", 422);
  const { reelId } = await context.params;
  const reel = await prisma.reel.findFirst({ where: { id: reelId, status: "ACTIVE", product: { status: "ACTIVE", complianceStatus: "CLEAR", deletedAt: null }, sellerProfile: { status: "APPROVED" } }, select: { id: true } });
  if (!reel) return apiError("REEL_NOT_FOUND", "Reel not found.", 404);
  const comment = await prisma.$transaction(async (tx) => {
    const created = await tx.reelComment.create({ data: { reelId, authorId: session.userId, body: parsed.data.body }, select: { id: true, status: true, createdAt: true, version: true } });
    await tx.auditLog.create({ data: { actorId: session.userId, action: "reel.comment_submitted", entityType: "ReelComment", entityId: created.id, metadata: { reelId } } });
    return created;
  });
  return apiSuccess({ comment, message: "Your comment is awaiting moderation." }, { status: 201, headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
