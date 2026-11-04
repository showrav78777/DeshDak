import Link from "next/link";
import { redirect } from "next/navigation";
import { SellerReelSubmission, SellerReelUpdate } from "@/components/seller-reel-manager";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { getServerSession } from "@/lib/server-session";

export const dynamic = "force-dynamic";

export default async function SellerReelsPage() {
  const session = await getServerSession();
  if (!session?.roles.includes(ROLE.SELLER) || session.portal !== "seller") redirect("/seller/login");
  const seller = await prisma.sellerProfile.findUnique({ where: { userId: session.userId }, select: { id: true, businessName: true, status: true, products: { where: { status: "ACTIVE", complianceStatus: "CLEAR", deletedAt: null }, select: { id: true, titleEn: true, media: { where: { kind: "VIDEO", status: "READY", reel: null }, select: { id: true, altText: true, originalFilename: true } } }, orderBy: { titleEn: "asc" } }, reels: { select: { id: true, reelCode: true, caption: true, status: true, reviewNote: true, version: true, viewCount: true, likeCount: true, commentCount: true, shareCount: true, createdAt: true, product: { select: { titleEn: true, productCode: true } } }, orderBy: { createdAt: "desc" }, take: 100 } } });
  if (!seller) redirect("/seller/login");
  const eligible = seller.products.filter((product) => product.media.length);
  return <main className="dashboard-shell"><nav className="site-nav"><Link className="brand" href="/seller/dashboard"><span className="brand-mark">D</span><span>DeshDak Seller</span></Link><div className="seller-nav-links"><Link href="/seller/products">Products</Link><Link href="/seller/orders">Orders</Link><Link href="/reels">Public Reels</Link><span className="dashboard-user">{session.fullName}</span></div></nav><section className="seller-products-content"><div className="seller-catalog-heading"><div><p className="eyebrow">VIDEO COMMERCE</p><h1>Product Reels</h1><p className="seller-catalog-principle">Connect an approved product video, submit it for moderation, and review performance without leaving DeshDak.</p></div></div>{seller.status === "APPROVED" ? <SellerReelSubmission products={eligible} /> : <div className="dashboard-card"><h2>Seller approval required</h2></div>}<section className="seller-reel-list"><h2>Your Reels</h2>{seller.reels.length ? seller.reels.map((reel) => <article className="dashboard-card" key={reel.id}><header><div><p className="eyebrow">{reel.reelCode} · {reel.product.productCode}</p><h3>{reel.product.titleEn}</h3></div><b className={`status-${reel.status.toLowerCase()}`}>{reel.status.replaceAll("_", " ")}</b></header><p>{reel.caption}</p><div className="seller-reel-metrics"><span>{reel.viewCount} views</span><span>{reel.likeCount} likes</span><span>{reel.commentCount} comments</span><span>{reel.shareCount} shares</span></div>{reel.reviewNote ? <p className="seller-review-note">Admin note: {reel.reviewNote}</p> : null}<SellerReelUpdate reel={reel} /></article>) : <div className="dashboard-card"><p>No Reel has been submitted.</p></div>}</section></section></main>;
}
