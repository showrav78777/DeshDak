import { type NextRequest } from "next/server";
import { apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requestMarketCountry } from "@/lib/customer-market";
import { convertMarketAmount, getMarketMoneyContext } from "@/lib/market-money";
import { getRequestSession } from "@/lib/request-session";
import { publicReelMediaUrl } from "@/modules/reels/media";
import { reelRankingScore, stableExplorationSeed } from "@/modules/reels/ranking";

export async function GET(request: NextRequest) {
  const session = await getRequestSession(request);
  const marketCountry = await requestMarketCountry(request, session);
  const money = await getMarketMoneyContext(marketCountry, session?.identityRoles.includes("customer_business") ? "BUSINESS" : "PERSONAL");
  const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") ?? 1) || 1);
  const pageSize = Math.min(20, Math.max(1, Number(request.nextUrl.searchParams.get("pageSize") ?? 10) || 10));
  const productId = request.nextUrl.searchParams.get("productId")?.trim();
  const where = {
    status: "ACTIVE" as const,
    publishedAt: { not: null },
    ...(productId ? { productId } : {}),
    media: { is: { kind: "VIDEO" as const, status: "READY" as const } },
    sellerProfile: { is: { status: "APPROVED" as const } },
    product: { is: { status: "ACTIVE" as const, complianceStatus: "CLEAR" as const, deletedAt: null, category: { is: { isActive: true } } } },
  };

  const [candidates, total, viewer] = await Promise.all([
    prisma.reel.findMany({
      where,
      select: {
        id: true, reelCode: true, caption: true, publishedAt: true, viewCount: true, completedViewCount: true, totalWatchTimeMs: true, likeCount: true, saveCount: true, commentCount: true, shareCount: true, productClickCount: true,
        media: { select: { storageKey: true, mimeType: true, altText: true, caption: true } },
        product: { select: { id: true, productCode: true, titleEn: true, titleBn: true, categoryId: true, minimumOrderQuantity: true, variants: { where: { stockStatus: { in: ["IN_STOCK", "PREORDER"] } }, select: { id: true, priceBdt: true, priceCurrency: true, inventoryQuantity: true, stockStatus: true }, orderBy: { createdAt: "asc" }, take: 1 } } },
        sellerProfile: { select: { businessName: true, storeSlug: true } },
      },
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      take: 200,
    }),
    prisma.reel.count({ where }),
    session ? prisma.user.findUnique({ where: { id: session.userId }, select: { analyticsConsent: true } }) : null,
  ]);

  const recentEvents = session && viewer?.analyticsConsent ? await prisma.userEvent.findMany({ where: { userId: session.userId, eventType: { in: ["PRODUCT_VIEW", "CATEGORY_VIEW"] } }, select: { objectType: true, objectId: true }, orderBy: { occurredAt: "desc" }, take: 100 }) : [];
  const affinityProducts = new Set(recentEvents.filter((event) => event.objectType === "Product").map((event) => event.objectId));
  const affinityCategories = new Set(recentEvents.filter((event) => event.objectType === "Category").map((event) => event.objectId));
  const viewerKey = session?.userId ?? "anonymous";
  const ranked = candidates.map((reel) => {
    const affinity = affinityProducts.has(reel.product.id) ? 1 : affinityCategories.has(reel.product.categoryId) ? 0.65 : 0;
    const score = reelRankingScore({ ...reel, affinity, explorationSeed: stableExplorationSeed(reel.reelCode, viewerKey), publishedAt: reel.publishedAt! });
    return { reel, score };
  }).sort((left, right) => right.score - left.score || right.reel.publishedAt!.getTime() - left.reel.publishedAt!.getTime());
  const selected = ranked.slice((page - 1) * pageSize, page * pageSize);
  const selectedIds = selected.map(({ reel }) => reel.id);
  const reactions = session && selectedIds.length ? await prisma.reelReaction.findMany({ where: { userId: session.userId, reelId: { in: selectedIds } }, select: { reelId: true, type: true } }) : [];
  const reactionMap = new Map(selectedIds.map((id) => [id, new Set(reactions.filter((reaction) => reaction.reelId === id).map((reaction) => reaction.type))]));

  const reels = selected.map(({ reel }) => {
    const viewerReactions = reactionMap.get(reel.id) ?? new Set();
    return {
      id: reel.id,
      reelCode: reel.reelCode,
      caption: reel.caption,
      publishedAt: reel.publishedAt,
      media: { url: publicReelMediaUrl(reel.media.storageKey), mimeType: reel.media.mimeType, altText: reel.media.altText, caption: reel.media.caption },
      product: { ...reel.product, variants: reel.product.variants.map((variant) => ({ ...variant, displayPrice: convertMarketAmount(variant.priceBdt, money), displayCurrency: money.currency })) },
      store: reel.sellerProfile,
      engagement: { views: reel.viewCount, likes: reel.likeCount, saves: reel.saveCount, comments: reel.commentCount, shares: reel.shareCount, productClicks: reel.productClickCount },
      viewer: { liked: viewerReactions.has("LIKE"), saved: viewerReactions.has("SAVE") },
    };
  });

  return apiSuccess({ reels, meta: { page, pageSize, total, hasNextPage: page * pageSize < Math.min(total, 200), rankingPolicy: "completion_engagement_affinity_freshness_exploration_v1" } }, { headers: { "Cache-Control": session ? "private, no-store, max-age=0" : "public, s-maxage=30, stale-while-revalidate=60" } });
}
