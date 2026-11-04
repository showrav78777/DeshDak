import { Prisma } from "@prisma/client";
import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { reelSubmissionSchema } from "@/modules/reels/schemas";

async function approvedSeller(userId: string) {
  return prisma.sellerProfile.findUnique({ where: { userId }, select: { id: true, status: true } });
}

export async function GET(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.SELLER) || session.portal !== "seller") return apiError("SELLER_ACCESS_REQUIRED", "Seller access is required.", 403);
  const seller = await approvedSeller(session.userId);
  if (!seller) return apiError("SELLER_NOT_FOUND", "Seller profile not found.", 404);
  const reels = await prisma.reel.findMany({ where: { sellerProfileId: seller.id }, select: { id: true, reelCode: true, caption: true, status: true, reviewNote: true, version: true, viewCount: true, likeCount: true, commentCount: true, shareCount: true, productClickCount: true, createdAt: true, publishedAt: true, product: { select: { id: true, productCode: true, titleEn: true } }, media: { select: { id: true, mimeType: true, altText: true } } }, orderBy: { createdAt: "desc" }, take: 100 });
  return apiSuccess({ reels }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function POST(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.SELLER) || session.portal !== "seller") return apiError("SELLER_ACCESS_REQUIRED", "Seller access is required.", 403);
  const seller = await approvedSeller(session.userId);
  if (!seller) return apiError("SELLER_NOT_FOUND", "Seller profile not found.", 404);
  if (seller.status !== "APPROVED") return apiError("SELLER_NOT_APPROVED", "Seller approval is required before submitting Reels.", 403);
  const parsed = reelSubmissionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Check the Reel details.", 422, { fields: parsed.error.flatten().fieldErrors });
  const product = await prisma.product.findFirst({ where: { id: parsed.data.productId, sellerProfileId: seller.id, status: "ACTIVE", complianceStatus: "CLEAR", deletedAt: null }, select: { id: true, media: { where: { id: parsed.data.mediaId, kind: "VIDEO", status: "READY" }, select: { id: true }, take: 1 } } });
  if (!product) return apiError("PRODUCT_NOT_AVAILABLE", "Choose one of your approved active products.", 422);
  if (!product.media.length) return apiError("VIDEO_NOT_READY", "Choose a video that has passed media security review.", 422);
  try {
    const reel = await prisma.$transaction(async (tx) => {
      const created = await tx.reel.create({ data: { sellerProfileId: seller.id, productId: product.id, mediaId: parsed.data.mediaId, caption: parsed.data.caption, status: "PENDING_REVIEW" }, select: { id: true, reelCode: true, status: true, version: true } });
      await tx.auditLog.create({ data: { actorId: session.userId, action: "reel.submitted", entityType: "Reel", entityId: created.id, metadata: { reelCode: created.reelCode, productId: product.id, mediaId: parsed.data.mediaId } } });
      return created;
    });
    return apiSuccess({ reel }, { status: 201, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return apiError("VIDEO_ALREADY_SUBMITTED", "This video is already assigned to a Reel.", 409);
    throw error;
  }
}
