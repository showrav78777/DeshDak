import Link from "next/link";
import { AiCapability, AiConfigurationStatus } from "@prisma/client";
import { AddToCartButton } from "@/components/add-to-cart-button";
import { formatMarketMoney, getMarketMoneyContext } from "@/lib/market-money";
import { prisma } from "@/lib/prisma";
import { productMarketPriority } from "@/modules/catalog/market-policy";
import { getAiConfiguration } from "@/modules/ai/configuration";

type MarketRecommendationsProps = {
  marketCountry: string;
  businessCustomer: boolean;
  excludeProductId?: string;
  categoryId?: string;
};

export async function MarketRecommendations({ marketCountry, businessCustomer, excludeProductId, categoryId }: MarketRecommendationsProps) {
  const [configuration, money, candidates] = await Promise.all([
    getAiConfiguration(AiCapability.RECOMMENDATIONS),
    getMarketMoneyContext(marketCountry, businessCustomer ? "BUSINESS" : "PERSONAL"),
    prisma.product.findMany({
      where: {
        id: excludeProductId ? { not: excludeProductId } : undefined,
        status: "ACTIVE",
        complianceStatus: "CLEAR",
        deletedAt: null,
        categoryId: categoryId ?? undefined,
        category: { is: { isActive: true } },
        OR: [{ sellerProfileId: null }, { sellerProfile: { is: { status: "APPROVED" } } }],
      },
      select: {
        id: true,
        titleEn: true,
        shortDescription: true,
        originCountryCode: true,
        isInternationallyAvailable: true,
        minimumOrderQuantity: true,
        completenessScore: true,
        category: { select: { nameEn: true } },
        sellerProfile: { select: { businessName: true } },
        variants: { select: { id: true, priceBdt: true, inventoryQuantity: true, stockStatus: true }, orderBy: { createdAt: "asc" }, take: 1 },
        _count: { select: { reviews: { where: { status: "PUBLISHED" } }, reels: { where: { status: "ACTIVE" } } } },
      },
      orderBy: [{ completenessScore: "desc" }, { updatedAt: "desc" }],
      take: 32,
    }),
  ]);

  const aiRankingEnabled = configuration.status === AiConfigurationStatus.LIVE;

  const products = candidates
    .map((product) => {
      const variant = product.variants[0];
      const available = Boolean(variant?.priceBdt) && variant.inventoryQuantity !== 0 && !["OUT_OF_STOCK", "SOLD_OUT", "UNAVAILABLE"].includes(variant?.stockStatus ?? "");
      const score = (available ? 40 : 0)
        + product.completenessScore / 4
        + product._count.reels * 7
        + Math.min(product._count.reviews, 20)
        - productMarketPriority(product.originCountryCode, marketCountry) * 12;
      return { product, variant, available, score };
    })
    .sort((left, right) => right.score - left.score || left.product.titleEn.localeCompare(right.product.titleEn))
    .slice(0, 8);

  if (!products.length) return null;

  return <section className="market-recommendations" aria-labelledby="market-recommendations-title">
    <div className="section-heading market-recommendations-heading">
      <div>
        <p className="eyebrow">SMART DISCOVERY</p>
        <h2 id="market-recommendations-title">{categoryId ? "Similar products you may like." : aiRankingEnabled ? "Picked for your market." : "Recommended products."}</h2>
        <p className="section-note">{categoryId ? "More approved products from this category, ranked by availability, listing quality, customer interest, product Reels, and your selected shopping market." : aiRankingEnabled ? "Ranked using availability, listing quality, customer interest, product Reels, and your selected shopping market—not private account data." : "Popular approved products selected by availability, listing quality, and your shopping market."}</p>
      </div>
      <Link href="/products">See all products →</Link>
    </div>
    <div className="market-recommendation-grid">
      {products.map(({ product, variant, available }) => <article className="market-recommendation-card" key={product.id}>
        <Link className="market-recommendation-main" href={`/products/${product.id}`}>
          <div className="market-recommendation-art" aria-hidden="true"><span>{product.category?.nameEn.slice(0, 1) ?? "◇"}</span>{product._count.reels ? <small>▶ Reel available</small> : null}</div>
          <div>
            <small>{product.sellerProfile?.businessName ?? product.category?.nameEn ?? "Approved marketplace"} · {product.originCountryCode}</small>
            <h3>{product.titleEn}</h3>
            <p>{product.shortDescription ?? "Open the listing to see variants, specifications, media, and delivery information."}</p>
            <strong>{variant?.priceBdt ? formatMarketMoney(variant.priceBdt, money) : "Request price"}</strong>
          </div>
        </Link>
        <footer>
          <span>{available ? "Ready to order" : "Check availability"}</span>
          {variant ? <AddToCartButton compact disabled={!available} productVariantId={variant.id} quantity={Math.min(product.minimumOrderQuantity, 99)} /> : null}
        </footer>
      </article>)}
    </div>
  </section>;
}
