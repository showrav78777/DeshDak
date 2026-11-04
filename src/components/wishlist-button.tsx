"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

export function WishlistButton({ productId, initialSaved = false, refreshOnRemove = false }: { productId: string; initialSaved?: boolean; refreshOnRemove?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const [saved, setSaved] = useState(initialSaved);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function toggle() {
    setSaving(true);
    setError("");
    const response = await fetch(saved ? `/api/v1/wishlist/items/${productId}` : "/api/v1/wishlist/items", {
      method: saved ? "DELETE" : "POST",
      headers: saved ? undefined : { "Content-Type": "application/json" },
      body: saved ? undefined : JSON.stringify({ productId }),
    });
    const result = await response.json();
    if (response.status === 401) {
      router.push(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }
    setSaving(false);
    if (!response.ok) return setError(result.error?.message ?? "Could not update your wishlist.");
    setSaved(!saved);
    if (saved && refreshOnRemove) router.refresh();
  }

  return <div className="wishlist-control"><button type="button" className={saved ? "wishlist-button saved" : "wishlist-button"} aria-pressed={saved} disabled={saving} onClick={toggle}><span aria-hidden="true">{saved ? "♥" : "♡"}</span>{saving ? "Saving…" : saved ? "Saved to wishlist" : "Save to wishlist"}</button>{error ? <small role="alert">{error}</small> : null}</div>;
}
