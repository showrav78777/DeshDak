import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import { CustomerLogoutButton } from "@/components/customer-logout-button";
import { DuarIcon } from "@/components/duar-icon";
import { MarketplaceMenuController } from "@/components/marketplace-menu-controller";
import { MarketCountrySelector } from "@/components/market-country-selector";
import { UnifiedProductSearch } from "@/components/unified-product-search";
import { serverMarketCountry } from "@/lib/customer-market";
import { prisma } from "@/lib/prisma";
import type { SessionPayload } from "@/lib/session";

function firstName(fullName: string) {
  return fullName.trim().split(/\s+/)[0] || fullName;
}

function NotificationBell({ unreadCount }: { unreadCount: number }) {
  const label = unreadCount ? `${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}` : "Notifications";
  return <Link className="notification-bell" href="/notifications" aria-label={label} title={label}><DuarIcon name="notification" />{unreadCount ? <b>{unreadCount > 99 ? "99+" : unreadCount}</b> : null}</Link>;
}

export async function StoreHeader({ session }: { session: SessionPayload | null }) {
  const [unreadCount, configuredCountries, marketCountry, categories] = await Promise.all([
    session ? prisma.notification.count({ where: { userId: session.userId, readAt: null } }) : 0,
    prisma.country.findMany({ where: { isActive: true }, select: { isoCode: true, name: true }, orderBy: { name: "asc" } }),
    serverMarketCountry(session),
    prisma.category.findMany({ where: { isActive: true }, select: { id: true, slug: true, nameEn: true, icon: true }, orderBy: [{ sortOrder: "asc" }, { nameEn: "asc" }], take: 12 }),
  ]);
  const countries = configuredCountries;
  return <header className="store-header marketplace-header">
    <MarketplaceMenuController />
    <div className="marketplace-header-main">
      <BrandLogo />
      <div className="marketplace-header-search"><UnifiedProductSearch compact /></div>
      <Link className="header-reels-button" href="/reels" aria-label="Watch product Reels"><span><DuarIcon name="reels" size={15} /></span><b>Reels</b></Link>
      {session ? <div className="header-actions"><MarketCountrySelector countries={countries} currentCountry={marketCountry} /><Link className="header-icon-link header-orders-link" href="/orders" aria-label="Orders and tracking" title="Orders and tracking"><DuarIcon name="orders" /></Link><Link className="header-icon-link" href="/cart" aria-label="Shopping cart" title="Shopping cart"><DuarIcon name="cart" /></Link><NotificationBell unreadCount={unreadCount} /><details className="customer-menu"><summary aria-label="Open account menu"><i>{firstName(session.fullName).slice(0, 1).toUpperCase()}</i><span>{firstName(session.fullName)}</span></summary><div><b>{session.fullName}</b><small>{session.email}</small><Link href="/dashboard">Dashboard</Link><Link href="/profile">My profile</Link><Link href="/orders">My orders</Link><Link href="/wishlist">Wishlist</Link><Link href="/ship-for-me">Ship for Me</Link><Link href="/rmas">Returns & claims</Link><Link href="/help">Help Centre</Link><Link href="/support">Support</Link><Link href="/notifications">Notifications{unreadCount ? ` (${unreadCount})` : ""}</Link><Link href="/wallet">Wallet</Link><Link href="/security/sessions">Devices & security</Link><Link href="/trust">Trust Centre</Link><CustomerLogoutButton /></div></details></div> : <div className="header-actions"><MarketCountrySelector countries={countries} currentCountry={marketCountry} /><Link className="header-icon-link" href="/cart" aria-label="Shopping cart" title="Shopping cart"><DuarIcon name="cart" /></Link><Link className="header-sign-in" href="/login">Sign in</Link><Link className="nav-cta" href="/register">Join</Link></div>}
    </div>
    <div className="marketplace-header-secondary"><nav aria-label="Marketplace navigation"><details className="category-mega-menu"><summary>All categories <span aria-hidden="true">⌄</span></summary><div>{categories.map((category) => <Link href={`/products?category=${encodeURIComponent(category.slug)}`} key={category.id}><span aria-hidden="true">{category.icon ?? "◇"}</span>{category.nameEn}</Link>)}<Link className="category-all-link" href="/products">View all products →</Link></div></details><Link href="/">Home</Link><Link href="/products">Products</Link><Link href="/buy-ship">Buy & Ship</Link><Link href="/ship-for-me">Ship for Me</Link><Link href="/orders">Tracking</Link><Link href="/stores">Bangladesh stores</Link><Link href="/support">Support</Link></nav>{session ? <span className="signed-market-link">{countries.length ? `Shopping market: ${marketCountry}` : "No shopping market enabled"}</span> : <Link href="/seller/apply">Sell worldwide</Link>}</div>
  </header>;
}

export function CustomerNav({ session }: { session: SessionPayload }) {
  return <StoreHeader session={session} />;
}
