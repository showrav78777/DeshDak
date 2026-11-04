import type { NextConfig } from "next";

const privatePageSources = [
  "/admin/:path*", "/warehouse/:path*", "/logistics/:path*", "/inspector/:path*",
  "/support/:path*", "/dashboard/:path*", "/orders/:path*", "/wallet/:path*",
  "/cart/:path*", "/checkout/:path*", "/notifications/:path*", "/security/:path*",
  "/rmas/:path*", "/scan/:path*", "/print/:path*", "/profile/:path*",
  "/wishlist/:path*", "/buy-ship/:path*", "/ship-for-me/:path*",
  "/seller/dashboard/:path*", "/seller/orders/:path*", "/seller/products/:path*",
  "/seller/store/:path*", "/seller/integrations/:path*", "/finance/:path*",
  "/compliance/:path*", "/sourcing/:path*",
] as const;

const privatePageHeaders = [
  { key: "Cache-Control", value: "private, no-store, max-age=0, must-revalidate" },
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
];

const nextConfig: NextConfig = {
  // The isolated verifier owns this generated directory; never reuse a normal
  // development/build cache across independent schemas or framework versions.
  ...(process.env.NODE_ENV === "development" && /^\.next-crossly_launch_verify_[a-f0-9]{16}$/.test(process.env.CROSSLY_ISOLATED_DIST_DIR ?? "")
    ? { distDir: process.env.CROSSLY_ISOLATED_DIST_DIR } : {}),
  output: "standalone",
  allowedDevOrigins: ["127.0.0.1"],
  // The isolated multi-role suite revisits routes after the default 60-second
  // development eviction window. Retain compiled entries for that bounded run
  // instead of making user mutations wait for repeated webpack compilation.
  // This changes neither normal dev defaults nor production behavior.
  ...(process.env.NODE_ENV === "development" && process.env.CROSSLY_ISOLATED_ROUTE_RETENTION === "1"
    ? { onDemandEntries: { maxInactiveAge: 15 * 60 * 1000, pagesBufferLength: 64 } }
    : {}),
  async headers() {
    return [{ source: "/(.*)", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(self)" },
      { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" },
    ] }, ...privatePageSources.map((source) => ({ source, headers: privatePageHeaders })), {
      source: "/sw.js",
      headers: [
        { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        { key: "Service-Worker-Allowed", value: "/" },
      ],
    }];
  },
};

export default nextConfig;
