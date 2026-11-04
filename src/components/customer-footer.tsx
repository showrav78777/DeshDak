"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandLogo } from "@/components/brand-logo";
import { hidesCustomerChrome } from "@/lib/customer-route";

export function CustomerFooter() {
  const pathname = usePathname();
  if (hidesCustomerChrome(pathname) || pathname.startsWith("/reels")) return null;

  return <footer className="customer-footer">
    <div className="customer-footer-grid">
      <section><BrandLogo /><p>One secure marketplace for global sourcing, approved Bangladesh stores, trackable logistics, and customer support.</p><Link className="footer-reels-link" href="/reels"><span aria-hidden="true">▶</span> Watch product Reels</Link></section>
      <nav aria-label="Marketplace"><b>Marketplace</b><Link href="/products">Explore products</Link><Link href="/stores">Bangladesh stores</Link><Link href="/#categories">Categories</Link><Link href="/wishlist">Saved products</Link></nav>
      <nav aria-label="Services"><b>Services</b><Link href="/buy-ship">Buy & Ship</Link><Link href="/ship-for-me">Ship for Me</Link><Link href="/orders">Orders and tracking</Link><Link href="/wallet">DeshDak Wallet</Link></nav>
      <nav aria-label="Help and policies"><b>Help and policies</b><Link href="/help">Help Centre and FAQ</Link><Link href="/support">Customer support</Link><Link href="/trust">Trust Centre</Link><Link href="/trust#privacy">Privacy and cookies</Link><Link href="/trust#protection-boundaries">Returns and refunds</Link></nav>
      <nav aria-label="Account"><b>Account</b><Link href="/dashboard">Dashboard</Link><Link href="/profile">Profile and addresses</Link><Link href="/notifications">Notifications</Link><Link href="/security/sessions">Security and devices</Link><Link href="/seller/apply">Sell through DeshDak</Link></nav>
    </div>
    <div className="customer-footer-bottom"><span>© {new Date().getFullYear()} DeshDak. All rights reserved.</span><span>Public browsing · Secure checkout · Trackable delivery</span></div>
  </footer>;
}
