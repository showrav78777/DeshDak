import type { MetadataRoute } from "next";

function siteOrigin() {
  return new URL(process.env.APP_BASE_URL?.trim() || "http://localhost:3000").origin;
}

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/products", "/products/", "/stores", "/stores/", "/trust", "/help", "/help/"],
      disallow: ["/api/", "/admin/", "/seller/", "/warehouse/", "/logistics/", "/inspector/", "/support/tickets/", "/dashboard", "/orders", "/wallet", "/cart", "/checkout", "/notifications", "/security/", "/rmas", "/scan/", "/print/", "/login", "/register"],
    },
    sitemap: `${siteOrigin()}/sitemap.xml`,
    host: siteOrigin(),
  };
}
