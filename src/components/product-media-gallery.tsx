"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

type GalleryMedia = {
  id: string;
  kind: "IMAGE" | "VIDEO" | "DOCUMENT";
  url: string | null;
  mimeType: string;
  altText: string | null;
  caption: string | null;
};

export function ProductMediaGallery({ media, productTitle }: { media: GalleryMedia[]; productTitle: string }) {
  const displayable = media.filter((item) => item.kind !== "DOCUMENT");
  const [selectedId, setSelectedId] = useState(displayable[0]?.id ?? "");
  const [expanded, setExpanded] = useState(false);
  const selected = displayable.find((item) => item.id === selectedId) ?? displayable[0];

  useEffect(() => {
    if (!expanded) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setExpanded(false); };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [expanded]);

  function visual(className: string) {
    if (!selected?.url) return <div className={`${className} product-media-placeholder`}><span aria-hidden="true">◇</span><b>Product media awaiting secure delivery</b><small>Approved images and videos appear after the media host is configured.</small></div>;
    if (selected.kind === "VIDEO") return <video className={className} controls playsInline preload="metadata" aria-label={selected.altText ?? `${productTitle} video`}><source src={selected.url} type={selected.mimeType} /></video>;
    return <Image className={className} src={selected.url} alt={selected.altText ?? productTitle} width={1200} height={1200} sizes="(max-width: 900px) 100vw, 46vw" priority unoptimized />;
  }

  return <section className="standalone-product-media" aria-label={`${productTitle} media gallery`}>
    <button className="product-media-main" type="button" onClick={() => selected?.url && setExpanded(true)} aria-label={selected?.url ? "Open product media fullscreen" : "Product media unavailable"}>{visual("product-media-visual")}<span>{selected?.kind === "VIDEO" ? "Product video" : "Zoom image"}</span></button>
    {displayable.length > 1 ? <div className="product-media-thumbnails" role="list">{displayable.map((item, index) => <button className={item.id === selected?.id ? "active" : ""} key={item.id} type="button" onClick={() => setSelectedId(item.id)} aria-label={`Show ${item.kind.toLowerCase()} ${index + 1}`} aria-pressed={item.id === selected?.id}><span>{item.kind === "VIDEO" ? "▶" : "◇"}</span><small>{item.caption ?? item.altText ?? `${item.kind} ${index + 1}`}</small></button>)}</div> : null}
    {media.some((item) => item.kind === "DOCUMENT") ? <p className="product-media-documents">Product documents are available after secure sign-in and eligibility review.</p> : null}
    {expanded ? <div className="product-media-lightbox" role="dialog" aria-modal="true" aria-label={`${productTitle} fullscreen media`} onClick={() => setExpanded(false)}><button type="button" onClick={() => setExpanded(false)} aria-label="Close fullscreen media">×</button><div onClick={(event) => event.stopPropagation()}>{visual("product-media-expanded")}</div></div> : null}
  </section>;
}
