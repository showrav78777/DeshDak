import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatMarketMoney, getMarketMoneyContext } from "@/lib/market-money";
import { productMarketPriority } from "@/modules/catalog/market-policy";

type HomepageReelsProps = { marketCountry: string; businessCustomer: boolean };

export async function HomepageReels({ marketCountry, businessCustomer }: HomepageReelsProps) {
  const [money, reels] = await Promise.all([
    getMarketMoneyContext(marketCountry, businessCustomer ? "BUSINESS" : "PERSONAL"),
    prisma.reel.findMany({
      where: { status: "ACTIVE", product: { is: { status: "ACTIVE", complianceStatus: "CLEAR", deletedAt: null } } },
      select: {
        id: true, caption: true, viewCount: true, likeCount: true,
        product: { select: { id: true, titleEn: true, originCountryCode: true, variants: { select: { priceBdt: true }, orderBy: { createdAt: "asc" }, take: 1 } } },
      },
      orderBy: [{ viewCount: "desc" }, { publishedAt: "desc" }],
      take: 18,
    }),
  ]);

  const featured = reels
    .sort((left, right) => productMarketPriority(left.product.originCountryCode, marketCountry) - productMarketPriority(right.product.originCountryCode, marketCountry) || right.viewCount - left.viewCount)
    .slice(0, 5);

  if (!featured.length) return null;

  return <section className="homepage-reels" aria-labelledby="homepage-reels-title">
    <div className="homepage-reels-heading">
      <div>
        <p className="eyebrow">WATCH &amp; SHOP</p>
        <h2 id="homepage-reels-title">See products in action.</h2>
        <p>Watch short product videos, open the listing, and shop when you are ready. Reels are public—sign-in is only needed for account actions.</p>
      </div>
      <Link href="/reels">Open Reels →</Link>
    </div>
    <div className="homepage-reels-track">
      {featured.map((reel) => <Link className="homepage-reel-card" href={`/reels?reel=${reel.id}`} key={reel.id}>
        <div className="homepage-reel-media" aria-hidden="true"><span>{reel.product.titleEn.slice(0, 1)}</span><i>▶</i><small>{reel.viewCount.toLocaleString()} views</small></div>
        <div className="homepage-reel-copy"><b>{reel.product.titleEn}</b><span>{reel.product.originCountryCode} · {reel.likeCount.toLocaleString()} likes</span><strong>{reel.product.variants[0]?.priceBdt ? formatMarketMoney(reel.product.variants[0].priceBdt, money) : "View product"}</strong></div>
      </Link>)}
    </div>
  </section>;
}
