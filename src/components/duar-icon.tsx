import type { ReactNode } from "react";

type DuarIconName = "account" | "ai" | "cart" | "close" | "explore" | "home" | "image" | "menu" | "notification" | "orders" | "reels" | "search";

export function DuarIcon({ name, size = 20, title }: { name: DuarIconName; size?: number; title?: string }) {
  const common = { "aria-hidden": title ? undefined : true, className: "duar-icon", fill: "none", height: size, role: title ? "img" : undefined, stroke: "currentColor", strokeLinecap: "round" as const, strokeLinejoin: "round" as const, strokeWidth: 1.8, viewBox: "0 0 24 24", width: size };
  const paths = {
    home: <><path d="m3 11 9-8 9 8v9a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" /></>,
    explore: <><circle cx="12" cy="12" r="9" /><path d="m15.7 8.3-2.2 5.2-5.2 2.2 2.2-5.2Z" /></>,
    reels: <><rect height="18" rx="4" width="16" x="4" y="3" /><path d="m10 8 6 4-6 4Z" /></>,
    cart: <><path d="M3 4h2l2.2 10.2a2 2 0 0 0 2 1.6h7.9a2 2 0 0 0 1.9-1.4L21 8H6" /><circle cx="10" cy="20" r="1" /><circle cx="18" cy="20" r="1" /></>,
    account: <><circle cx="12" cy="8" r="4" /><path d="M4.5 21a7.5 7.5 0 0 1 15 0" /></>,
    orders: <><path d="M6 3h12v18H6z" /><path d="M9 8h6M9 12h6M9 16h4" /></>,
    notification: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
    image: <><rect height="16" rx="2" width="18" x="3" y="4" /><circle cx="8" cy="9" r="1.2" /><path d="m4 18 5.4-5.3 3.6 3.5 2.3-2.2L20 18" /></>,
    ai: <><path d="M12 3 13.6 8.4 19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6Z" /><path d="m18.5 16 .7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7Z" /></>,
    menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
  } satisfies Record<DuarIconName, ReactNode>;
  return <svg {...common}>{title ? <title>{title}</title> : null}{paths[name]}</svg>;
}
