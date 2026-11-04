"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CART_UPDATED_EVENT } from "@/components/mobile-marketplace-nav";

type Reel = {
  id: string;
  reelCode: string;
  caption: string | null;
  media: { url: string | null; mimeType: string; altText: string | null; caption: string | null };
  product: { id: string; productCode: string; titleEn: string; titleBn: string | null; minimumOrderQuantity: number; variants: { id: string; priceBdt: string; priceCurrency: string; displayPrice: string | null; displayCurrency: "BDT" | "USD"; inventoryQuantity: number | null; stockStatus: string }[] };
  store: { businessName: string; storeSlug: string | null };
  engagement: { views: number; likes: number; saves: number; comments: number; shares: number; productClicks: number };
  viewer: { liked: boolean; saved: boolean };
};

type Comment = { id: string; body: string; publishedAt: string; author: { fullName: string } };

async function jsonRequest(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error?.message ?? "Request failed."), { status: response.status });
  return result.data;
}

function ReelCard({ initial }: { initial: Reel }) {
  const router = useRouter();
  const video = useRef<HTMLVideoElement>(null);
  const viewSent = useRef(false);
  const [reel, setReel] = useState(initial);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [message, setMessage] = useState("");
  const [muted, setMuted] = useState(true);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && entry.intersectionRatio >= 0.7) void element.play().catch(() => undefined);
      else element.pause();
    }, { threshold: [0.25, 0.7] });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  async function recordView(completed = false) {
    const element = video.current;
    if (!element || viewSent.current || !Number.isFinite(element.duration) || element.duration <= 0) return;
    const completion = completed ? 100 : Math.min(100, Math.round((element.currentTime / element.duration) * 100));
    if (!completed && completion < 25) return;
    viewSent.current = true;
    await fetch(`/api/v1/reels/${reel.id}/engagements`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "VIEW", idempotencyKey: crypto.randomUUID(), watchTimeMs: Math.round(element.currentTime * 1000), durationMs: Math.round(element.duration * 1000), completionPercent: completion }) }).catch(() => undefined);
  }

  async function react(type: "LIKE" | "SAVE") {
    const key = type === "LIKE" ? "liked" : "saved";
    const active = !reel.viewer[key];
    try {
      const data = await jsonRequest(`/api/v1/reels/${reel.id}/reactions`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, active }) });
      setReel((current) => ({ ...current, viewer: { ...current.viewer, [key]: active }, engagement: { ...current.engagement, likes: data.counts.likes, saves: data.counts.saves } }));
    } catch (error) {
      if ((error as { status?: number }).status === 401) router.push("/login?next=/reels"); else setMessage((error as Error).message);
    }
  }

  async function share() {
    const url = `${window.location.origin}/reels?reel=${reel.id}`;
    try {
      if (navigator.share) await navigator.share({ title: reel.product.titleEn, text: reel.caption ?? reel.product.titleEn, url });
      else await navigator.clipboard.writeText(url);
    } catch { return; }
    await fetch(`/api/v1/reels/${reel.id}/engagements`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "SHARE", idempotencyKey: crypto.randomUUID() }) }).catch(() => undefined);
    setReel((current) => ({ ...current, engagement: { ...current.engagement, shares: current.engagement.shares + 1 } }));
  }

  async function openComments() {
    setCommentsOpen((open) => !open);
    if (!comments.length) {
      const data = await jsonRequest(`/api/v1/reels/${reel.id}/comments`).catch(() => null);
      if (data) setComments(data.comments);
    }
  }

  async function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage("");
    const form = event.currentTarget;
    const body = String(new FormData(form).get("body") ?? "");
    try {
      const data = await jsonRequest(`/api/v1/reels/${reel.id}/comments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body }) });
      form.reset(); setMessage(data.message);
    } catch (error) {
      if ((error as { status?: number }).status === 401) router.push("/login?next=/reels"); else setMessage((error as Error).message);
    }
  }

  async function buyNow() {
    const variant = reel.product.variants[0];
    if (!variant) return setMessage("This product is not currently available.");
    try {
      void fetch(`/api/v1/reels/${reel.id}/engagements`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "PRODUCT_CLICK", idempotencyKey: crypto.randomUUID() }) }).catch(() => undefined);
      await jsonRequest("/api/v1/cart/items", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productVariantId: variant.id, quantity: reel.product.minimumOrderQuantity }) });
      window.dispatchEvent(new Event(CART_UPDATED_EVENT));
      router.push("/cart");
    } catch (error) {
      if ((error as { status?: number }).status === 401) router.push("/login?next=/reels"); else setMessage((error as Error).message);
    }
  }

  async function addToCart() {
    const variant = reel.product.variants[0];
    if (!variant) return setMessage("This product is not currently available.");
    try {
      void fetch(`/api/v1/reels/${reel.id}/engagements`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "PRODUCT_CLICK", idempotencyKey: crypto.randomUUID() }) }).catch(() => undefined);
      await jsonRequest("/api/v1/cart/items", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productVariantId: variant.id, quantity: reel.product.minimumOrderQuantity }) });
      window.dispatchEvent(new Event(CART_UPDATED_EVENT));
      setMessage("Added to cart. You can keep watching or open your cart when ready.");
    } catch (error) {
      if ((error as { status?: number }).status === 401) router.push("/login?next=/reels"); else setMessage((error as Error).message);
    }
  }

  const variant = reel.product.variants[0];
  return <article className="reel-card" id={`reel-${reel.id}`}>
    <div className="reel-stage">
      {reel.media.url ? <video aria-label={reel.media.altText ?? reel.product.titleEn} loop muted={muted} playsInline preload="metadata" ref={video} onClick={() => { const element = video.current; if (!element) return; if (element.paused) void element.play(); else element.pause(); }} onEnded={() => void recordView(true)} onPause={() => void recordView(false)}><source src={reel.media.url} type={reel.media.mimeType} /></video> : <div className="reel-media-unavailable"><span>▶</span><b>Video delivery is not configured</b><small>The approved Reel is protected until secure media hosting is connected.</small></div>}
      {reel.media.url ? <button className="reel-sound-toggle" type="button" aria-label={muted ? "Turn sound on" : "Mute video"} onClick={() => setMuted((current) => !current)}>{muted ? "Sound off" : "Sound on"}</button> : null}
      <div className="reel-gradient" />
      <div className="reel-copy"><p className="eyebrow">{reel.reelCode}</p>{reel.store.storeSlug ? <Link href={`/stores/${reel.store.storeSlug}`}>@{reel.store.businessName}</Link> : <b>{reel.store.businessName}</b>}<h2>{reel.product.titleEn}</h2>{reel.product.titleBn ? <small>{reel.product.titleBn}</small> : null}<p>{reel.caption}</p><div><strong>{variant ? variant.displayPrice ? `${variant.displayCurrency === "USD" ? "$" : "৳"}${Number(variant.displayPrice).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "USD rate unavailable" : "Price unavailable"}</strong><button onClick={addToCart} type="button">Add to cart</button><button className="reel-buy-now" onClick={buyNow} type="button">Buy now</button><Link href={`/products/${reel.product.id}`}>View product</Link></div>{message ? <em role="status">{message}</em> : null}</div>
      <nav aria-label="Reel actions" className="reel-actions"><button aria-label={`${reel.viewer.liked ? "Remove like from" : "Like"} ${reel.product.titleEn}. ${reel.engagement.likes} likes`} aria-pressed={reel.viewer.liked} onClick={() => void react("LIKE")} type="button"><span aria-hidden="true">♡</span>{reel.engagement.likes}</button><button aria-label={`${reel.viewer.saved ? "Remove" : "Save"} ${reel.product.titleEn}. ${reel.engagement.saves} saves`} aria-pressed={reel.viewer.saved} onClick={() => void react("SAVE")} type="button"><span aria-hidden="true">▱</span>{reel.engagement.saves}</button><button aria-label={`View comments for ${reel.product.titleEn}. ${reel.engagement.comments} comments`} aria-expanded={commentsOpen} onClick={() => void openComments()} type="button"><span aria-hidden="true">◌</span>{reel.engagement.comments}</button><button aria-label={`Share ${reel.product.titleEn}. ${reel.engagement.shares} shares`} onClick={() => void share()} type="button"><span aria-hidden="true">↗</span>{reel.engagement.shares}</button></nav>
    </div>
    {commentsOpen ? <section className="reel-comments"><h3>Comments</h3>{comments.length ? comments.map((comment) => <article key={comment.id}><b>{comment.author.fullName}</b><p>{comment.body}</p></article>) : <p>No published comments yet.</p>}<form onSubmit={submitComment}><label htmlFor={`comment-${reel.id}`}>Add a comment</label><textarea id={`comment-${reel.id}`} maxLength={500} minLength={2} name="body" required /><button className="button primary" type="submit">Submit for review</button></form></section> : null}
  </article>;
}

export function ReelsFeed() {
  const [reels, setReels] = useState<Reel[]>([]);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load(nextPage: number) {
    setLoading(true); setError("");
    try {
      const data = await jsonRequest(`/api/v1/reels?page=${nextPage}&pageSize=10`);
      setReels((current) => nextPage === 1 ? data.reels : [...current, ...data.reels]); setPage(nextPage); setHasNext(data.meta.hasNextPage);
    } catch (caught) { setError((caught as Error).message); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    let active = true;
    void jsonRequest("/api/v1/reels?page=1&pageSize=10").then((data) => {
      if (!active) return;
      setReels(data.reels); setPage(1); setHasNext(data.meta.hasNextPage);
      const requested = new URLSearchParams(window.location.search).get("reel");
      if (requested) window.requestAnimationFrame(() => document.getElementById(`reel-${requested}`)?.scrollIntoView({ block: "start" }));
    }).catch((caught) => { if (active) setError((caught as Error).message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  if (!loading && !reels.length) return <div className="reels-empty"><span>▶</span><h2>No Reels are published yet</h2><p>Approved seller videos will appear here after moderation.</p></div>;
  return <section className="reels-feed" aria-busy={loading}>{reels.map((reel) => <ReelCard initial={reel} key={reel.id} />)}{error ? <p className="form-error" role="alert">{error}</p> : null}{loading ? reels.length ? <p className="reels-loading" role="status">Loading more Reels…</p> : <div className="reels-loading-card" role="status"><div aria-hidden="true"><span /><span /><span /></div><p>Loading product Reels…</p></div> : hasNext ? <button className="button secondary reels-more" onClick={() => void load(page + 1)} type="button">Load more</button> : null}</section>;
}
