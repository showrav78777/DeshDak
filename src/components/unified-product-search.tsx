"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { DuarIcon } from "@/components/duar-icon";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { OPEN_SHOPPING_ASSISTANT_EVENT } from "@/components/global-customer-actions";

type ProductResult = { id: string; titleEn: string; variants: { priceBdt: string | null; displayPrice?: string | null; displayCurrency?: "BDT" | "USD" }[] };
type ChatMessage = { role: "user" | "assistant"; text: string; products?: ProductResult[]; loginUrl?: string; handoffSuggested?: boolean };
type HandoffState = { status: "idle" | "loading" | "login" | "complete" | "error"; message?: string; ticketId?: string; reference?: string };

function resultPrice(product: ProductResult) {
  const variant = product.variants[0];
  if (!variant?.priceBdt) return "View product";
  if (variant.displayPrice === null) return "USD rate unavailable";
  const amount = variant.displayPrice ?? variant.priceBdt;
  return `${variant.displayCurrency === "USD" ? "$" : "৳"}${Number(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function UnifiedProductSearch({ defaultQuery = "", compact = false }: { defaultQuery?: string; compact?: boolean }) {
  const router = useRouter();
  const container = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [imageStatus, setImageStatus] = useState("");
  const [imageLoading, setImageLoading] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [assistantError, setAssistantError] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [handoff, setHandoff] = useState<HandoffState>({ status: "idle" });

  useEffect(() => {
    let active = true;
    async function restoreConversation() {
      const response = await fetch("/api/v1/ai/chat", { cache: "no-store" });
      const result = await response.json().catch(() => null);
      if (!active || !response.ok) return;
      if (Array.isArray(result.data?.messages)) setMessages(result.data.messages);
      if (result.data?.handoffCompleted) setHandoff({ status: "complete", message: "This conversation was transferred. Sign in to open your support center." });
      if (new URLSearchParams(window.location.search).get("assistant") === "chat") setAssistantOpen(true);
    }
    void restoreConversation();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const openAssistant = () => setAssistantOpen(true);
    const closeOutside = (event: PointerEvent) => {
      if (container.current && !container.current.contains(event.target as Node)) setAssistantOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAssistantOpen(false);
    };
    window.addEventListener(OPEN_SHOPPING_ASSISTANT_EVENT, openAssistant);
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener(OPEN_SHOPPING_ASSISTANT_EVENT, openAssistant);
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  async function searchImage(event: ChangeEvent<HTMLInputElement>) {
    const image = event.target.files?.[0];
    if (!image) return;
    setImageLoading(true);
    setImageStatus(`Checking ${image.name}…`);
    const input = event.currentTarget;
    try {
      const body = new FormData();
      body.append("image", image);
      const response = await fetch("/api/v1/search/image", { method: "POST", body });
      const result = await response.json().catch(() => null);
      setImageStatus(response.ok ? "Visual matches are ready." : result?.error?.message ?? "Image matching is temporarily unavailable.");
    } catch {
      setImageStatus("Image search could not reach the server. Check your connection and try again.");
    } finally {
      setImageLoading(false);
      input.value = "";
    }
  }

  async function askAssistant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (chatLoading) return;
    const form = event.currentTarget;
    const text = String(new FormData(form).get("message") ?? "").trim();
    if (!text) return;
    const turnKey = crypto.randomUUID();
    setMessages((current) => [...current, { role: "user", text }]);
    setHandoff({ status: "idle" });
    setAssistantError("");
    form.reset();
    setChatLoading(true);
    try {
      const response = await fetch("/api/v1/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: text, turnKey }) });
      const result = await response.json().catch(() => null);
      setMessages((current) => [...current, response.ok && result?.data
        ? { role: "assistant", text: result.data.answer, products: result.data.products, loginUrl: result.data.loginUrl, handoffSuggested: result.data.handoffSuggested }
        : { role: "assistant", text: result?.error?.message ?? "The shopping assistant is temporarily unavailable. Please try again." }]);
    } catch {
      setAssistantError("The assistant could not reach the server. Check your connection, then try again.");
    } finally {
      setChatLoading(false);
    }
  }

  function submitProductSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = String(new FormData(event.currentTarget).get("q") ?? "").trim();
    router.push(query ? `/products?q=${encodeURIComponent(query)}` : "/products");
  }

  async function requestHumanSupport() {
    setHandoff({ status: "loading" });
    const response = await fetch("/api/v1/ai/chat/handoff", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": `ai-handoff-${crypto.randomUUID()}` }, body: "{}" });
    const result = await response.json();
    if (response.status === 401) return setHandoff({ status: "login", message: "Sign in first; this conversation will remain available for the secure transfer." });
    if (!response.ok) return setHandoff({ status: "error", message: result.error?.message ?? "The conversation could not be transferred." });
    setHandoff({ status: "complete", message: "Your conversation is now in the Customer Service queue.", ticketId: result.data.ticket.id, reference: result.data.ticket.reference });
  }

  return <div ref={container} className={`unified-search ${compact ? "unified-search-compact" : ""}`}>
    <form action="/products" className="unified-search-bar" onSubmit={submitProductSearch}><span aria-hidden="true"><DuarIcon name="search" /></span><input aria-label="Search products" defaultValue={defaultQuery} maxLength={200} name="q" placeholder="Search by product name, category, or description" /><button className="unified-image-button" disabled={imageLoading} onClick={() => fileInput.current?.click()} title="Search using a product image" type="button" aria-label="Search using a product image"><DuarIcon name="image" /></button><input ref={fileInput} aria-label="Choose a product image to search" className="unified-file-input" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={searchImage} type="file" /><button className={`unified-assistant-button ${assistantOpen ? "active" : ""}`} onClick={() => setAssistantOpen((open) => !open)} title="Ask the shopping assistant" type="button" aria-label="Ask the shopping assistant"><DuarIcon name="ai" /></button><button aria-label="Search products" className="unified-submit" type="submit"><DuarIcon name="search" /><span>Search</span></button></form>
    {imageStatus ? <div className="unified-search-notice"><span>{imageLoading ? "◌" : "▧"}</span><p>{imageStatus}</p><button onClick={() => setImageStatus("")} type="button" aria-label="Dismiss image search message">×</button></div> : null}
    {assistantOpen ? <section className="unified-assistant" aria-label="Shopping assistant"><div className="unified-assistant-head"><div><b>Shopping assistant</b><span>Public questions need no login. Personal support transfers require secure sign-in.</span></div><button onClick={() => setAssistantOpen(false)} type="button" aria-label="Close shopping assistant">×</button></div>{messages.length ? <div className="unified-chat-log" aria-live="polite">{messages.map((message, index) => <div className={message.role} key={`${message.role}-${index}`}><b>{message.role === "assistant" ? "DeshDak" : "You"}</b><p>{message.text}</p>{message.products?.length ? <div className="unified-chat-products">{message.products.map((product) => <Link href={`/products/${product.id}`} key={product.id}><span>{product.titleEn}</span><b>{resultPrice(product)}</b></Link>)}</div> : null}{message.loginUrl ? <Link className="unified-login-link" href={message.loginUrl}>Sign in securely →</Link> : null}{message.handoffSuggested && index === messages.length - 1 && handoff.status === "idle" ? <button className="unified-handoff-button" onClick={requestHumanSupport} type="button">Transfer to Customer Service</button> : null}</div>)}{chatLoading ? <div className="assistant"><b>DeshDak</b><p>Checking approved information…</p></div> : null}</div> : <div><p className="unified-assistant-welcome">How can I help you shop today?</p><p className="unified-assistant-examples">Try: “wireless earbuds”, “how does Buy & Ship work?”, or “show product Reels”.</p></div>}{assistantError ? <p className="form-error unified-assistant-error" role="alert">{assistantError}</p> : null}{handoff.status !== "idle" ? <div className={`unified-handoff-status ${handoff.status}`} role="status"><p>{handoff.status === "loading" ? "Creating the secure support handoff…" : handoff.message}</p>{handoff.status === "login" ? <Link href="/login?next=%2F%3Fassistant%3Dchat">Sign in and return →</Link> : null}{handoff.status === "complete" && handoff.ticketId ? <Link href={`/support/${handoff.ticketId}`}>Open {handoff.reference} →</Link> : null}</div> : null}<form className="unified-chat-form" onSubmit={askAssistant}><input aria-label="Ask a shopping question" autoComplete="off" maxLength={500} minLength={2} name="message" placeholder="Ask a shopping question" required /><button disabled={chatLoading} type="submit">{chatLoading ? "Checking…" : "Send"}</button></form></section> : null}
  </div>;
}
