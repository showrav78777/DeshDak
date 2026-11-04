"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { hidesCustomerChrome } from "@/lib/customer-route";

type Advertisement = { id: string; adCode: string; advertiserName: string; title: string; body: string | null; imageUrl: string | null; targetUrl: string; altText: string | null; isDismissible: boolean };

function contextualPlacement(pathname: string) {
  if (pathname === "/") return "HOME_FEED";
  if (pathname === "/cart") return "CART";
  if (pathname.startsWith("/reels")) return "REELS";
  if (/^\/products\/[^/]+/.test(pathname)) return "PRODUCT_DETAIL";
  if (pathname.startsWith("/products")) return "PRODUCT_LIST";
  return null;
}

function AdLink({ advertisement, className }: { advertisement: Advertisement; className: string }) {
  const external = advertisement.targetUrl.startsWith("https://");
  return <Link className={className} href={advertisement.targetUrl} target={external ? "_blank" : undefined} rel={external ? "sponsored noopener noreferrer" : "sponsored"}>
    {advertisement.imageUrl ? <Image src={advertisement.imageUrl} alt={advertisement.altText ?? ""} width={560} height={280} sizes="(max-width: 700px) 92vw, 560px" unoptimized /> : null}
    <span><small>Sponsored · {advertisement.advertiserName}</small><b>{advertisement.title}</b>{advertisement.body ? <p>{advertisement.body}</p> : null}</span>
  </Link>;
}

export function CustomerAdvertising() {
  const pathname = usePathname();
  const hidden = hidesCustomerChrome(pathname);
  const [banner, setBanner] = useState<Advertisement | null>(null);
  const [popup, setPopup] = useState<Advertisement | null>(null);

  useEffect(() => {
    if (hidden) return;
    let active = true;
    const context = contextualPlacement(pathname);
    const placements = ["GLOBAL_BANNER", "ENTRY_POPUP", ...(context ? [context] : [])];
    void Promise.all(placements.map(async (placement) => {
      const response = await fetch(`/api/v1/advertisements?placement=${placement}&path=${encodeURIComponent(pathname)}`, { cache: "no-store" });
      const result = await response.json().catch(() => null);
      return { placement, item: response.ok ? result.data?.advertisements?.[0] as Advertisement | undefined : undefined };
    })).then((results) => {
      if (!active) return;
      const contextAd = context ? results.find((result) => result.placement === context)?.item : undefined;
      setBanner(contextAd ?? results.find((result) => result.placement === "GLOBAL_BANNER")?.item ?? null);
      const popupAd = results.find((result) => result.placement === "ENTRY_POPUP")?.item;
      if (popupAd && sessionStorage.getItem(`crossly:ad-dismissed:${popupAd.id}`) !== "1") setPopup(popupAd);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [hidden, pathname]);

  if (hidden) return null;
  function dismiss(advertisement: Advertisement) {
    sessionStorage.setItem(`crossly:ad-dismissed:${advertisement.id}`, "1");
    if (popup?.id === advertisement.id) setPopup(null);
    if (banner?.id === advertisement.id) setBanner(null);
  }

  return <>
    {banner ? <aside className="customer-ad-banner" aria-label="Sponsored advertisement"><AdLink advertisement={banner} className="customer-ad-banner-link" />{banner.isDismissible ? <button onClick={() => dismiss(banner)} type="button" aria-label="Dismiss advertisement">×</button> : null}</aside> : null}
    {popup ? <div className="customer-ad-popup-backdrop" role="presentation" onClick={() => popup.isDismissible && dismiss(popup)}><aside className="customer-ad-popup" role="dialog" aria-modal="true" aria-label="Sponsored offer" onClick={(event) => event.stopPropagation()}>{popup.isDismissible ? <button onClick={() => dismiss(popup)} type="button" aria-label="Close advertisement">×</button> : null}<AdLink advertisement={popup} className="customer-ad-popup-link" /></aside></div> : null}
  </>;
}
