import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { PwaManager } from "@/components/pwa-manager";
import { MobileMarketplaceNav } from "@/components/mobile-marketplace-nav";
import { CustomerFooter } from "@/components/customer-footer";
import { GlobalCustomerActions } from "@/components/global-customer-actions";
import { CustomerAdvertising } from "@/components/customer-advertising";
import "./globals.css";
import "./identifiers.css";
import "./mobile-marketplace-nav.css";
import "./marketplace-header-footer.css";
import "./design-system.css";
import "./customer-mobile-header.css";
import "./homepage-ux-upgrade.css";
import "./platform-ux-upgrade.css";
import "./mobile-navbar-upgrade.css";
import "./orders-ux.css";
import "./product-marketplace-ux.css";
import "./marketplace-readability.css";
import "./experience-polish.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: process.env.APP_BASE_URL ? new URL(process.env.APP_BASE_URL) : undefined,
  title: { default: "DeshDak | Cross-border commerce", template: "%s | DeshDak" },
  description: "Source approved products, shop Bangladesh stores, and manage cross-border orders through one secure DeshDak application.",
  applicationName: "DeshDak",
  keywords: ["DeshDak", "cross-border shopping", "Bangladesh sellers", "international sourcing", "worldwide ecommerce"],
  authors: [{ name: "DeshDak" }],
  creator: "DeshDak",
  publisher: "DeshDak",
  category: "ecommerce",
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 } },
  openGraph: { siteName: "DeshDak", type: "website", locale: "en_BD" },
  twitter: { card: "summary_large_image", title: "DeshDak", description: "Cross-border commerce in one secure application." },
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "DeshDak" },
  formatDetection: { telephone: false },
  icons: {
    apple: [{ url: "/icons/deshdak-v2-192.png", sizes: "192x192", type: "image/png" }],
  },
};

export const viewport = {
  themeColor: "#0b1647",
  colorScheme: "light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body suppressHydrationWarning className="min-h-full flex flex-col">
        <a className="crossly-skip-link" href="#app-content">Skip to main content</a>
        <div className="app-route-content" id="app-content" tabIndex={-1}>{children}</div>
        <CustomerFooter />
        <CustomerAdvertising />
        <GlobalCustomerActions />
        <MobileMarketplaceNav />
        <PwaManager />
      </body>
    </html>
  );
}
