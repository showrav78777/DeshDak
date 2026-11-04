"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

export function MarketplaceMenuController() {
  const pathname = usePathname();

  useEffect(() => {
    const closeAll = () => document.querySelectorAll<HTMLDetailsElement>(".marketplace-header details[open]").forEach((menu) => menu.removeAttribute("open"));
    const onPointerDown = (event: PointerEvent) => {
      document.querySelectorAll<HTMLDetailsElement>(".marketplace-header details[open]").forEach((menu) => {
        if (!menu.contains(event.target as Node)) menu.removeAttribute("open");
      });
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const openMenu = document.querySelector<HTMLDetailsElement>(".marketplace-header details[open]");
      openMenu?.querySelector<HTMLElement>("summary")?.focus();
      closeAll();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [pathname]);

  return null;
}
