"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { CART_UPDATED_EVENT } from "@/components/mobile-marketplace-nav";

type CartItem = { id: string; quantity: number; isAvailable: boolean; quoteRequired: boolean; lineTotal: string | null; displayLineTotal: string | null; variant: { id: string; sku: string | null; attributes: unknown; priceBdt: string | null; displayPrice: string | null; stockStatus: string | null }; product: { id: string; titleEn: string; titleBn: string | null; categoryName: string | null; sellerName: string | null } };
type Cart = { id: string | null; currency: string; displayCurrency: "BDT" | "USD"; displaySubtotal: string | null; fxRateAvailable: boolean; itemCount: number; subtotal: string; hasUnavailableItems: boolean; hasQuoteRequiredItems: boolean; fulfillmentKind: string; items: CartItem[] };

function money(amount: string | null, currency: "BDT" | "USD") {
  if (amount === null) return currency === "USD" ? "USD rate unavailable" : "Request price";
  return `${currency === "USD" ? "$" : "৳"}${Number(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function optionName(item: CartItem) {
  if (item.variant.attributes && typeof item.variant.attributes === "object") return Object.values(item.variant.attributes as Record<string, unknown>).join(" · ");
  return item.variant.sku ?? "Standard option";
}

export function CartManagement({ initialCart }: { initialCart: Cart }) {
  const [cart, setCart] = useState(initialCart);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function update(event: FormEvent<HTMLFormElement>, itemId: string) {
    event.preventDefault();
    await mutate(itemId, "PATCH", { quantity: Number(new FormData(event.currentTarget).get("quantity")) });
  }

  async function mutate(itemId: string, method: "PATCH" | "DELETE", body?: { quantity: number }) {
    setBusyItemId(itemId); setError("");
    const response = await fetch(`/api/v1/cart/items/${itemId}`, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    const result = await response.json();
    setBusyItemId(null);
    if (!response.ok) return setError(result.error?.message ?? "Unable to update the cart.");
    setCart(result.data.cart);
    window.dispatchEvent(new Event(CART_UPDATED_EVENT));
  }

  if (!cart.items.length) return <section className="cart-empty"><span aria-hidden="true">🛒</span><h2>Your cart is empty</h2><p>Add an approved product option when you are ready. Browsing remains public.</p><Link className="button primary" href="/products">Browse products</Link></section>;

  const mixedFulfillment = cart.fulfillmentKind === "MIXED";
  const canCheckout = Boolean(cart.id) && !cart.hasUnavailableItems && !cart.hasQuoteRequiredItems && !mixedFulfillment;
  return <div className="cart-layout"><section className="cart-items" aria-label="Cart items">{cart.items.map((item) => <article className={`cart-item${item.isAvailable ? "" : " cart-item-unavailable"}`} key={item.id}><div className="cart-item-art" aria-hidden="true">◇</div><div className="cart-item-copy"><p>{item.product.categoryName ?? "Approved catalog"}</p><Link href={`/products/${item.product.id}`}>{item.product.titleEn}</Link>{item.product.titleBn ? <small>{item.product.titleBn}</small> : null}<span>{optionName(item)}</span><span>{item.product.sellerName ? `Sold by ${item.product.sellerName}` : "Approved catalog product"}</span>{!item.isAvailable ? <strong>This option is no longer available. Remove it before checkout.</strong> : null}{item.quoteRequired ? <strong>Price confirmation is required before checkout.</strong> : null}</div><div className="cart-item-actions"><b>{item.variant.priceBdt ? money(item.variant.displayPrice, cart.displayCurrency) : "Request price"}</b><form onSubmit={(event) => update(event, item.id)}><label htmlFor={`quantity-${item.id}`}>Quantity</label><input id={`quantity-${item.id}`} name="quantity" type="number" min="1" max="99" defaultValue={item.quantity} disabled={busyItemId === item.id || !item.isAvailable} /><button type="submit" disabled={busyItemId === item.id || !item.isAvailable}>Update</button></form><span>{item.lineTotal ? money(item.displayLineTotal, cart.displayCurrency) : "Not included"}</span><button className="cart-remove" type="button" onClick={() => mutate(item.id, "DELETE")} disabled={busyItemId === item.id}>{busyItemId === item.id ? "Working…" : "Remove"}</button></div></article>)}</section><aside className="cart-summary"><p className="eyebrow">ORDER SUMMARY</p><dl><div><dt>Items</dt><dd>{cart.itemCount}</dd></div><div><dt>Current subtotal</dt><dd>{money(cart.displaySubtotal, cart.displayCurrency)}</dd></div></dl><p>Shipping, inspection, duty, and other service costs are confirmed separately before payment.</p>{cart.hasUnavailableItems ? <div className="cart-warning">Remove unavailable items to continue.</div> : null}{cart.hasQuoteRequiredItems ? <div className="cart-warning">Some items require price confirmation.</div> : null}{mixedFulfillment ? <div className="cart-warning">Seller products and sourced products must be ordered separately. Remove one product type to continue.</div> : null}{canCheckout ? <Link className="button dark cart-checkout-link" href="/checkout">Continue to secure checkout</Link> : <button className="button dark" type="button" disabled>Checkout unavailable</button>}<Link href="/products">← Continue shopping</Link>{error ? <p className="form-error" role="alert">{error}</p> : null}</aside></div>;
}
