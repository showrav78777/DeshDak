"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { CART_UPDATED_EVENT } from "@/components/mobile-marketplace-nav";

type AddToCartButtonProps = {
  productVariantId: string;
  disabled?: boolean;
  /** The minimum permitted order quantity and initial quantity. */
  quantity?: number;
  availableStock?: number | null;
  showBuyNow?: boolean;
  compact?: boolean;
};

export function AddToCartButton({ productVariantId, disabled = false, quantity = 1, availableStock, showBuyNow = true, compact = false }: AddToCartButtonProps) {
  const pathname = usePathname();
  const router = useRouter();
  const maximumQuantity = Math.min(availableStock ?? 99, 99);
  const minimumQuantity = Math.max(1, Math.min(quantity, Math.max(1, maximumQuantity)));
  const canOrder = !disabled && maximumQuantity >= quantity;
  const [selectedQuantity, setSelectedQuantity] = useState(minimumQuantity);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");

  function setSafeQuantity(nextQuantity: number) {
    setSelectedQuantity(Math.max(minimumQuantity, Math.min(maximumQuantity, Number.isFinite(nextQuantity) ? nextQuantity : minimumQuantity)));
  }

  async function add(destination: "cart" | "checkout" = "cart") {
    if (!canOrder) return;
    setState("saving");
    setError("");
    setErrorCode("");
    const response = await fetch("/api/v1/cart/items", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productVariantId, quantity: selectedQuantity }) });
    const result = await response.json();
    if (response.status === 401) {
      router.push(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }
    if (!response.ok) {
      setState("idle");
      setError(result.error?.message ?? "Unable to add this item.");
      setErrorCode(result.error?.code ?? "");
      return;
    }
    setState("saved");
    window.dispatchEvent(new Event(CART_UPDATED_EVENT));
    if (destination === "checkout") router.push("/checkout");
  }

  const purchaseDisabled = !canOrder || state === "saving";
  return <div className={`add-cart-control${compact ? " is-compact" : ""}`}>
    {!compact ? <div className="purchase-quantity-row">
      <span>Quantity</span>
      <div className="quantity-stepper" aria-label="Choose quantity">
        <button aria-label="Decrease quantity" disabled={purchaseDisabled || selectedQuantity <= minimumQuantity} onClick={() => setSafeQuantity(selectedQuantity - 1)} type="button">−</button>
        <input aria-label="Quantity" disabled={purchaseDisabled} inputMode="numeric" min={minimumQuantity} max={maximumQuantity} onChange={(event) => setSafeQuantity(Number(event.target.value))} type="number" value={selectedQuantity} />
        <button aria-label="Increase quantity" disabled={purchaseDisabled || selectedQuantity >= maximumQuantity} onClick={() => setSafeQuantity(selectedQuantity + 1)} type="button">+</button>
      </div>
      {availableStock !== undefined && availableStock !== null ? <small className="add-cart-stock">{availableStock > 0 ? `${availableStock} available` : "Out of stock"}</small> : null}
    </div> : null}
    {!canOrder && !disabled ? <small className="add-cart-error" role="alert">Only {availableStock ?? 0} available; this option requires at least {quantity}.</small> : null}
    <div className="add-cart-buttons"><button className="button primary" type="button" disabled={purchaseDisabled} onClick={() => void add("cart")}>{state === "saving" ? "Adding…" : state === "saved" ? "Added ✓" : "Add to cart"}</button>{showBuyNow ? <button className="button coral" type="button" disabled={purchaseDisabled} onClick={() => void add("checkout")}>Buy now</button> : null}</div>
    {state === "saved" ? <Link href="/cart">View cart →</Link> : null}
    {error ? <div className="add-cart-error" role="alert"><small>{error}</small>{errorCode === "MIXED_FULFILLMENT_CART" ? <Link href="/cart">Open cart to checkout or clear it →</Link> : null}</div> : null}
  </div>;
}
