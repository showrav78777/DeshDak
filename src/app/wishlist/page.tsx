import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AddToCartButton } from "@/components/add-to-cart-button";
import { CustomerNav } from "@/components/store-header";
import { WishlistButton } from "@/components/wishlist-button";
import { prisma } from "@/lib/prisma";
import { formatMarketMoney, getMarketMoneyContext } from "@/lib/market-money";
import { ROLE } from "@/lib/roles";
import { getServerSession } from "@/lib/server-session";
import { publicWishlistProductWhere, wishlistProductSelect } from "@/modules/wishlist/catalog";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My wishlist", robots: { index: false, follow: false } };

function unavailable(stock: string | null, inventory: number | null) {
  return inventory === 0 || ["OUT_OF_STOCK", "UNAVAILABLE", "SOLD_OUT"].includes(stock ?? "");
}

export default async function WishlistPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [session, params] = await Promise.all([getServerSession(), searchParams]);
  if (!session?.roles.includes(ROLE.CUSTOMER_PERSONAL)) redirect("/login?next=/wishlist");
  const page = Math.max(1, Number(typeof params.page === "string" ? params.page : 1) || 1);
  const pageSize = 24;
  const where = { userId: session.userId, product: { is: publicWishlistProductWhere } };
  const [items, total] = await prisma.$transaction([
    prisma.wishlistItem.findMany({ where, select: { id: true, createdAt: true, product: { select: wishlistProductSelect } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
    prisma.wishlistItem.count({ where }),
  ]);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const money = await getMarketMoneyContext(session.residenceCountryCode, session.roles.includes("customer_business") ? "BUSINESS" : "PERSONAL");

  return <main className="dashboard-shell wishlist-page"><CustomerNav session={session} /><section className="wishlist-content"><div className="wishlist-head"><div><p className="eyebrow">MY WISHLIST</p><h1>Products saved for later.</h1><p>Availability and prices can change. DeshDak checks them again when you add a product to your cart.</p></div><b>{total} saved product{total === 1 ? "" : "s"}</b></div>{items.length ? <div className="wishlist-grid">{items.map(({ id, product }) => { const variant = product.variants[0]; return <article key={id}><Link className="wishlist-art" href={`/products/${product.id}`} aria-label={`View ${product.titleEn}`}>{product.media[0]?.kind === "VIDEO" ? "▶" : "◇"}</Link><div className="wishlist-card-copy"><small>{product.sellerProfile?.businessName ?? product.category?.nameEn ?? "Approved catalog"}</small><Link href={`/products/${product.id}`}><h2>{product.titleEn}</h2></Link>{product.titleBn ? <p>{product.titleBn}</p> : null}<div className="wishlist-price"><b>{variant?.priceBdt ? formatMarketMoney(variant.priceBdt, money) : "Request price"}</b><span>{variant?.stockStatus?.replaceAll("_", " ") ?? "Confirm availability"}</span></div><div className="wishlist-actions">{variant ? <AddToCartButton productVariantId={variant.id} disabled={unavailable(variant.stockStatus, variant.inventoryQuantity)} /> : <span className="wishlist-no-option">No purchasable option yet</span>}<WishlistButton productId={product.id} initialSaved refreshOnRemove /></div></div></article>; })}</div> : <div className="wishlist-empty"><span>♡</span><h2>Your wishlist is empty</h2><p>Save approved products while browsing and return to them from any signed-in device.</p><Link className="button primary" href="/products">Browse products</Link></div>}{pages > 1 ? <nav className="catalog-pagination" aria-label="Wishlist pages">{page > 1 ? <Link href={`/wishlist?page=${page - 1}`}>← Previous</Link> : <span />}<b>Page {page} of {pages}</b>{page < pages ? <Link href={`/wishlist?page=${page + 1}`}>Next →</Link> : <span />}</nav> : null}</section></main>;
}
