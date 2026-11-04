"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { type Appearance } from "@/modules/advertisements/appearance";

const fallbackSlides = [
  { src: "/brand/deshdak-worldwide.webp", alt: "DeshDak — Connecting Bangladesh to the World. Air shipping, sea shipping and safe delivery.", title: "Connecting Bangladesh to the world", copy: "Explore products and follow your delivery in one place." },
  { src: "/images/duar-global-marketplace-hero-v1.png", alt: "International shopping and delivery connecting global markets with Bangladesh", title: "Discover more. Shop worldwide.", copy: "Find your next product or send us a link to get started." },
];

export function HomeBannerCarousel({ bangladesh }: { bangladesh: boolean }) {
  const [slides, setSlides] = useState<Appearance["slides"]>(fallbackSlides.map((slide) => ({ ...slide, enabled: true })));
  const [index, setIndex] = useState(0);
  useEffect(() => { let active = true; fetch("/api/v1/website-appearance", { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((result) => { if (active && result?.data?.slides?.length) {setSlides(result.data.slides);setIndex(0);} }).catch(() => {}); return () => { active = false; }; }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setIndex((value) => (value + 1) % slides.length), 5000);
    return () => window.clearInterval(timer);
  }, [slides.length]);
  return <section className="deshdak-carousel" aria-label="DeshDak highlights" aria-roledescription="carousel">
    <div className="deshdak-carousel-art">
      {slides.map((slide, position) => position === index ? <div key={slide.src} role="group" aria-roledescription="slide" aria-label={`${position + 1} of ${slides.length}`}>
        <picture style={{position:"absolute",inset:0,display:"block"}}>{slide.mobileSrc ? <source media="(max-width: 850px)" srcSet={slide.mobileSrc} /> : null}<Image unoptimized src={slide.src} alt={slide.alt} fill priority={position === 0} sizes="(max-width: 850px) 100vw, 80vw" style={{ objectFit: "cover" }} /></picture>
        {slide.title ? <div className="deshdak-carousel-copy"><span>SHOP · SHIP · TRACK</span><h1>{slide.title}</h1><p>{slide.copy}</p></div> : null}
      </div> : null)}
    </div>
    <div className="deshdak-carousel-footer"><div className="deshdak-banner-actions"><Link className="button primary" href={slides[index]?.targetUrl ?? (bangladesh ? "/products" : "/stores")}>{slides[index]?.buttonLabel ?? (bangladesh ? "Explore products" : "Explore Bangladesh stores")}</Link><Link className="button secondary" href="/buy-ship">Buy &amp; Ship ↗</Link></div></div>
  </section>;
}
