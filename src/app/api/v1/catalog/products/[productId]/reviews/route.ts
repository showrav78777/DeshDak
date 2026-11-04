import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { productReviewSubmissionSchema } from "@/modules/reviews/schemas";

const noStore = { "Cache-Control": "private, no-store, max-age=0" };

function reviewerName(fullName: string) {
  return fullName.trim().split(/\s+/)[0] || "Customer";
}

function publicReview(review: { id: string; rating: number; title: string | null; body: string; verifiedPurchase: boolean; publishedAt: Date | null; customer: { fullName: string } }) {
  return { id: review.id, rating: review.rating, title: review.title, body: review.body, verifiedPurchase: review.verifiedPurchase, publishedAt: review.publishedAt, reviewerName: reviewerName(review.customer.fullName) };
}

function submittedReview(review: { id: string; rating: number; title: string | null; body: string; status: string; verifiedPurchase: boolean; createdAt: Date; updatedAt: Date }) {
  return { id: review.id, rating: review.rating, title: review.title, body: review.body, status: review.status, verifiedPurchase: review.verifiedPurchase, createdAt: review.createdAt, updatedAt: review.updatedAt };
}

export async function GET(request: NextRequest, context: RouteContext<"/api/v1/catalog/products/[productId]/reviews">) {
  const { productId } = await context.params;
  const page = Math.max(1, Number(request.nextUrl.searchParams.get("page")) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(request.nextUrl.searchParams.get("pageSize")) || 10));
  const product = await prisma.product.findFirst({ where: { id: productId, status: "ACTIVE", complianceStatus: "CLEAR", deletedAt: null, category: { is: { isActive: true } }, OR: [{ sellerProfileId: null }, { sellerProfile: { status: "APPROVED" } }] }, select: { id: true } });
  if (!product) return apiError("PRODUCT_NOT_FOUND", "Product not found.", 404);
  const where = { productId, status: "PUBLISHED" as const };
  const [reviews, aggregate] = await prisma.$transaction([
    prisma.productReview.findMany({ where, select: { id: true, rating: true, title: true, body: true, verifiedPurchase: true, publishedAt: true, customer: { select: { fullName: true } } }, orderBy: [{ publishedAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
    prisma.productReview.aggregate({ where, _count: { _all: true }, _avg: { rating: true } }),
  ]);
  return apiSuccess({ reviews: reviews.map(publicReview), summary: { count: aggregate._count._all, averageRating: aggregate._avg.rating ? Number(aggregate._avg.rating.toFixed(2)) : null }, pagination: { page, pageSize, total: aggregate._count._all, pages: Math.max(1, Math.ceil(aggregate._count._all / pageSize)) } }, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } });
}

export async function POST(request: NextRequest, context: RouteContext<"/api/v1/catalog/products/[productId]/reviews">) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.CUSTOMER_PERSONAL) || session.portal !== "customer") return apiError("CUSTOMER_ACCESS_REQUIRED", "Customer access is required to review a purchase.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "Submit reviews from the protected DeshDak application.", 403);
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
  if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 200) return apiError("IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required.", 422);
  const parsed = productReviewSubmissionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Check the review rating and text.", 422, { fields: parsed.error.flatten().fieldErrors });
  const { productId } = await context.params;
  const input = { ...parsed.data, title: parsed.data.title || null };
  const fingerprint = createHash("sha256").update(JSON.stringify({ productId, ...input })).digest("hex");
  const replay = await prisma.productReview.findUnique({ where: { idempotencyKey } });
  if (replay) {
    if (replay.customerId !== session.userId || replay.requestFingerprint !== fingerprint) return apiError("IDEMPOTENCY_KEY_CONFLICT", "This mutation key was used for another review.", 409);
    return apiSuccess({ review: submittedReview(replay), idempotentReplay: true }, { headers: noStore });
  }
  const item = await prisma.orderItem.findFirst({ where: { id: input.orderItemId, productId, order: { customerId: session.userId, status: "DELIVERED" } }, select: { id: true, productId: true, review: { select: { id: true } } } });
  if (!item) return apiError("REVIEW_NOT_ELIGIBLE", "Only the owner of a delivered order item can review this product.", 403);
  if (item.review) return apiError("REVIEW_ALREADY_SUBMITTED", "This delivered item already has a review.", 409);
  try {
    const review = await prisma.$transaction(async (tx) => {
      const created = await tx.productReview.create({ data: { productId, orderItemId: item.id, customerId: session.userId, rating: input.rating, title: input.title, body: input.body, idempotencyKey, requestFingerprint: fingerprint } });
      await tx.auditLog.create({ data: { actorId: session.userId, action: "product.review_submitted", entityType: "ProductReview", entityId: created.id, metadata: { productId, orderItemId: item.id, rating: input.rating } } });
      return created;
    });
    return apiSuccess({ review: submittedReview(review), idempotentReplay: false }, { status: 201, headers: noStore });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return apiError("REVIEW_SUBMISSION_CONFLICT", "This item was already reviewed or the mutation was already processed.", 409);
    throw error;
  }
}
