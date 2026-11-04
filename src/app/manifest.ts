import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "DeshDak",
    short_name: "DeshDak",
    description: "Cross-border shopping, sourcing, seller, warehouse, inspection, and logistics services.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#fffaf2",
    theme_color: "#0b1647",
    orientation: "any",
    categories: ["shopping", "business"],
    lang: "en",
    icons: [
      { src: "/icons/deshdak-v2-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/deshdak-v2-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/deshdak-v2-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Browse products", short_name: "Products", url: "/products", icons: [{ src: "/icons/deshdak-v2-192.png", sizes: "192x192" }] },
      { name: "My orders", short_name: "Orders", url: "/orders", icons: [{ src: "/icons/deshdak-v2-192.png", sizes: "192x192" }] },
      { name: "Warehouse scanner", short_name: "Scanner", url: "/warehouse/scan", icons: [{ src: "/icons/deshdak-v2-192.png", sizes: "192x192" }] },
      { name: "Logistics scanner", short_name: "Logistics", url: "/logistics/scan", icons: [{ src: "/icons/deshdak-v2-192.png", sizes: "192x192" }] },
    ],
  };
}
