"use client";

import Link from "next/link";
import { DuarIcon } from "@/components/duar-icon";
import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { hidesCustomerChrome } from "@/lib/customer-route";

export const CART_UPDATED_EVENT = "crossly:cart-updated";

function isActive(pathname: string, item: "home" | "explore" | "reels" | "cart" | "account") {
  if (item === "home") return pathname === "/" || pathname === "/dashboard";
  if (item === "explore") return ["/products", "/categories", "/stores"].some((path) => pathname.startsWith(path));
  if (item === "reels") return pathname.startsWith("/reels");
  if (item === "cart") return pathname.startsWith("/cart") || pathname.startsWith("/checkout");
  return ["/profile", "/account", "/login", "/register", "/orders", "/wallet", "/wishlist", "/notifications", "/rmas", "/security"].some((path) => pathname.startsWith(path));
}

export function MobileMarketplaceNav() {
  const pathname = usePathname();
  const [accountHref, setAccountHref] = useState("/login?next=/dashboard");
  const [cartCount, setCartCount] = useState(0);
  const hidden = hidesCustomerChrome(pathname);

  const refreshCart = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/cart", { cache: "no-store" });
      if (!response.ok) {
        setCartCount(0);
        setAccountHref("/login?next=/dashboard");
        return;
      }
      const result = await response.json();
      setCartCount(Number(result.data?.cart?.itemCount ?? 0));
      setAccountHref("/dashboard");
    } catch {
      // Keep navigation usable when the network is temporarily unavailable.
    }
  }, []);

  useEffect(() => {
    if (hidden) return;
    const initialRefresh = window.setTimeout(() => void refreshCart(), 0);
    window.addEventListener(CART_UPDATED_EVENT, refreshCart);
    window.addEventListener("focus", refreshCart);
    return () => {
      window.clearTimeout(initialRefresh);
      window.removeEventListener(CART_UPDATED_EVENT, refreshCart);
      window.removeEventListener("focus", refreshCart);
    };
  }, [hidden, pathname, refreshCart]);

  if (hidden) return null;

  const items = [
    { key: "home" as const, href: "/", label: "Home" },
    { key: "explore" as const, href: "/products", label: "Explore" },
    { key: "reels" as const, href: "/reels", label: "Reels" },
    { key: "cart" as const, href: "/cart", label: "Cart" },
    { key: "account" as const, href: accountHref, label: "Account" },
  ];

  return <>
    <div className="mobile-marketplace-nav-spacer" aria-hidden="true" />
    <nav className="mobile-marketplace-nav" aria-label="Mobile marketplace navigation">
      {items.map((item) => <Link className={`${item.key === "reels" ? "mobile-nav-reels " : ""}${isActive(pathname, item.key) ? "is-active" : ""}`} href={item.href} key={item.key} aria-current={isActive(pathname, item.key) ? "page" : undefined}>
        <span className="mobile-nav-icon"><DuarIcon name={item.key} />{item.key === "cart" && cartCount > 0 ? <b aria-label={`${cartCount} items in cart`}>{cartCount > 99 ? "99+" : cartCount}</b> : null}</span>
        <small>{item.label}</small>
      </Link>)}
    </nav>
  </>;
}
