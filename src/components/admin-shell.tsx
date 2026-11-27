"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { AdminLogoutButton } from "@/components/admin-logout-button";

type AdminShellProps = {
  adminName: string;
  children: ReactNode;
};

type AdminNavigationItem = {
  href: string;
  icon: string;
  label: string;
};

type AdminNavigationGroup = {
  label: string;
  description: string;
  items: AdminNavigationItem[];
};

export const ADMIN_NAVIGATION: AdminNavigationGroup[] = [
  { label: "Overview", description: "Today’s priorities and platform health", items: [{ href: "/admin", icon: "⌂", label: "Control center" }] },
  {
    label: "Commerce",
    description: "Orders, products, sellers and campaigns",
    items: [
      { href: "/admin/orders", icon: "↗", label: "Orders" },
      { href: "/admin/purchases", icon: "✓", label: "Purchase approvals" },
      { href: "/admin/shipping-quotes", icon: "৳", label: "Shipping quotes" },
      { href: "/admin/products", icon: "◇", label: "Products" },
      { href: "/admin/reviews", icon: "★", label: "Product reviews" },
      { href: "/admin/reels", icon: "▶", label: "Reels moderation" },
      { href: "/admin/categories", icon: "▦", label: "Categories" },
      { href: "/admin/sellers", icon: "♙", label: "Seller reviews" },
      { href: "/admin/seller-orders", icon: "▧", label: "Seller orders" },
      { href: "/admin/coupons", icon: "%", label: "Coupons" },
      { href: "/admin/promotions", icon: "✦", label: "Promotions" },
      { href: "/admin/website-content", icon: "▰", label: "Website Content Manager" },
    ],
  },
  {
    label: "Customers & finance",
    description: "Customers, money, payments and refunds",
    items: [
      { href: "/admin/customers", icon: "◎", label: "Customers" },
      { href: "/admin/sales", icon: "♜", label: "Sales & key accounts" },
      { href: "/admin/payment-methods", icon: "▣", label: "Payment methods" },
      { href: "/admin/payment-risk", icon: "!", label: "Payment risk review" },
      { href: "/admin/payment-reconciliation", icon: "≋", label: "Payment reconciliation" },
      { href: "/admin/fx-rates", icon: "⇆", label: "Exchange rates" },
      { href: "/admin/finance", icon: "¤", label: "Finance staff" },
      { href: "/admin/refunds", icon: "↺", label: "Refunds & wallet" },
    ],
  },
  {
    label: "Sourcing",
    description: "Product sources, markets and compliance",
    items: [
      { href: "/admin/sourcing", icon: "⌁", label: "Sourcing review" },
      { href: "/admin/source-integrations", icon: "⇄", label: "Source integrations" },
      { href: "/admin/seller-integrations", icon: "⇅", label: "Seller catalog APIs" },
      { href: "/admin/countries", icon: "◉", label: "Markets & delivery" },
      { href: "/admin/compliance", icon: "⚖", label: "Compliance rules" },
    ],
  },
  {
    label: "Operations",
    description: "Warehouse, parcels, returns and claims",
    items: [
      { href: "/admin/warehouses", icon: "▣", label: "Warehouses" },
      { href: "/admin/warehouse-operations", icon: "▤", label: "Warehouse operations" },
      { href: "/admin/warehouse-exceptions", icon: "!", label: "Parcel exceptions" },
      { href: "/admin/package-services", icon: "▦", label: "Package handling" },
      { href: "/admin/rmas", icon: "↺", label: "Returns & claims" },
    ],
  },
  {
    label: "Service",
    description: "Customer care, help and communication",
    items: [
      { href: "/admin/support", icon: "◉", label: "Customer support" },
      { href: "/admin/support/settings", icon: "⚙", label: "Support settings" },
      { href: "/admin/help", icon: "?", label: "Help centre" },
      { href: "/admin/notifications", icon: "♢", label: "Notifications" },
    ],
  },
  {
    label: "System",
    description: "Platform controls, audits and launch checks",
    items: [
      { href: "/admin/ai", icon: "✦", label: "AI & discovery" },
      { href: "/admin/audit-logs", icon: "≣", label: "Audit log" },
      { href: "/admin/private-photos", icon: "▣", label: "Private photo safety" },
      { href: "/admin/private-videos", icon: "▣", label: "Private video safety" },
      { href: "/admin/private-media", icon: "▣", label: "Media retention and holds" },
      { href: "/admin/launch-readiness", icon: "✓", label: "Launch readiness" },
      { href: "/admin/launch-readiness/setup", icon: "⚙", label: "Live setup guide" },
      { href: "/admin/system-maintenance", icon: "⚙", label: "System maintenance" },
    ],
  },
];

const ADMIN_PAGE_GUIDANCE: Record<string, string> = {
  "/admin": "Review live queues, launch readiness, and then open the work area that needs your attention.",
  "/admin/orders": "Publish verified order-status updates so customers can follow the complete delivery timeline.",
  "/admin/purchases": "Approve paid orders before purchasing, then record the outcome so operations can continue.",
  "/admin/shipping-quotes": "Review measured packages, issue the final shipping quote, and wait for customer approval.",
  "/admin/products": "Approve, reject, or request changes for local seller products before they become public.",
  "/admin/reviews": "Moderate customer product reviews and keep only appropriate, verified feedback visible.",
  "/admin/reels": "Review product Reels and comments before publication, or remove content that breaks policy.",
  "/admin/categories": "Create categories, control their order, and decide which approved categories appear on the storefront.",
  "/admin/sellers": "Review Bangladesh seller applications and verify the business before giving seller access.",
  "/admin/seller-orders": "Release verified paid seller orders so the seller can prepare the customer’s items.",
  "/admin/coupons": "Create coupon codes, set safe limits and dates, then activate or pause them as needed.",
  "/admin/promotions": "Create automatic discounts, set their priority, and confirm that customer savings are correct.",
  "/admin/advertisements": "Create and schedule banners, pop-ups, and placement-specific campaigns without changing code.",
  "/admin/website-content": "Prepare a draft, choose its placement and schedule, then activate approved website content.",
  "/admin/customers": "Find a customer, review their account history, and safely manage support, wallet, and account issues.",
  "/admin/sales": "Manage business accounts, sales opportunities, and follow-up activities for key customers.",
  "/admin/payment-methods": "Control where each payment method is available and keep payment setup ready for launch.",
  "/admin/payment-risk": "Review suspicious payments before fulfilment and record an auditable approve or reject decision.",
  "/admin/payment-reconciliation": "Match payment provider records with platform payments and resolve differences safely.",
  "/admin/fx-rates": "Create, review, and activate exchange rates used for customer-facing currency conversion.",
  "/admin/finance": "Grant and remove finance portal access only for verified employees with the right responsibility.",
  "/admin/refunds": "Review approved refunds and issue a wallet credit or follow the original-payment refund process.",
  "/admin/sourcing": "Review quote drafts independently before customers see a final sourcing price.",
  "/admin/source-integrations": "Configure approved product-source adapters, account limits, and health status without exposing secrets.",
  "/admin/seller-integrations": "Review seller catalogue connection requests and allow only safe, verified integrations.",
  "/admin/countries": "Manage customer markets and delivery routes; open checkout only after every readiness requirement is complete.",
  "/admin/compliance": "Maintain restricted-goods rules, grant least-privilege access, and oversee flagged screening work.",
  "/admin/warehouses": "Set up warehouses, locations, and assigned operations staff before packages are processed.",
  "/admin/warehouse-operations": "Receive packages, inspect them, measure them, and print labels in the required sequence.",
  "/admin/warehouse-exceptions": "Resolve confirmed warehouse exceptions and keep customer-facing updates accurate.",
  "/admin/package-services": "Approve consolidation, splitting, and repacking requests before warehouse work starts.",
  "/admin/rmas": "Review returns and claims, request evidence when needed, and publish the approved outcome.",
  "/admin/support": "Monitor workload and SLA risk, assign tickets, and keep accountability with the right support agent.",
  "/admin/support/settings": "Set operating hours, holidays, and agent shifts so support deadlines are calculated correctly.",
  "/admin/help": "Create, review, and publish customer help articles that answer common questions.",
  "/admin/notifications": "Review delivery status and run approved customer notifications or marketing campaigns.",
  "/admin/ai": "Set safe public AI limits and configuration; external providers remain inactive until separately approved.",
  "/admin/audit-logs": "Search the immutable history of important actions without exposing private credentials or secrets.",
  "/admin/launch-readiness": "Complete and verify each required launch gate before enabling paid customer transactions.",
  "/admin/launch-readiness/setup": "Follow the required setup areas, configure services securely, test them in staging, then record evidence in the launch register.",
  "/admin/system-maintenance": "Review maintenance status and run only the protected, documented cleanup operations.",
};

function isStandaloneAdminRoute(pathname: string) {
  return pathname === "/admin/login" || pathname === "/admin/setup" || /^\/admin\/packages\/[^/]+\/label$/.test(pathname);
}

function isActive(pathname: string, href: string) {
  if (href === "/admin") return pathname === href;
  const moreSpecificMatch = ADMIN_NAVIGATION.flatMap((group) => group.items).some(
    (item) => item.href !== href && item.href.startsWith(`${href}/`) && (pathname === item.href || pathname.startsWith(`${item.href}/`)),
  );
  return !moreSpecificMatch && (pathname === href || pathname.startsWith(`${href}/`));
}

export function AdminShell({ adminName, children }: AdminShellProps) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [navigationQuery, setNavigationQuery] = useState("");
  const currentGroup = ADMIN_NAVIGATION.find((group) => group.items.some((item) => isActive(pathname, item.href)));
  const [openGroups, setOpenGroups] = useState<string[]>([]);

  const currentItem = currentGroup?.items.find((item) => isActive(pathname, item.href));
  const pageGuidance = ADMIN_PAGE_GUIDANCE[currentItem?.href ?? "/admin"] ?? "Use the available controls to manage this part of the DeshDak platform.";
  const filteredNavigation = useMemo(() => {
    const query = navigationQuery.trim().toLowerCase();
    return ADMIN_NAVIGATION.map((group) => ({
      ...group,
      items: group.items.filter((item) => `${group.label} ${group.description} ${item.label}`.toLowerCase().includes(query)),
    })).filter((group) => group.items.length);
  }, [navigationQuery]);

  if (isStandaloneAdminRoute(pathname)) return children;

  function toggleGroup(label: string) {
    setOpenGroups((groups) => (groups.includes(label) ? groups.filter((group) => group !== label) : [...groups, label]));
  }

  return (
    <div className="admin-workspace">
      <a className="admin-skip-link" href="#admin-main-content">Skip to main content</a>
      <button
        aria-controls="admin-sidebar"
        aria-expanded={menuOpen}
        aria-label="Open administrator navigation"
        className="admin-menu-button"
        onClick={() => setMenuOpen(true)}
        type="button"
      >
        <span aria-hidden="true">☰</span>
        <span>Menu</span>
      </button>
      <button
        aria-label="Close administrator navigation"
        className={`admin-sidebar-backdrop${menuOpen ? " is-open" : ""}`}
        onClick={() => setMenuOpen(false)}
        tabIndex={menuOpen ? 0 : -1}
        type="button"
      />
      <aside className={`admin-sidebar${menuOpen ? " is-open" : ""}`} id="admin-sidebar">
        <header className="admin-sidebar-header">
          <Link aria-label="DeshDak Admin control center" className="admin-sidebar-brand" href="/admin" onClick={() => setMenuOpen(false)}>
            <span className="brand-mark" aria-hidden="true">D</span>
            <span><b>DeshDak</b><small>Administration</small></span>
          </Link>
          <button aria-label="Close administrator navigation" className="admin-sidebar-close" onClick={() => setMenuOpen(false)} type="button">×</button>
        </header>
        <div className="admin-sidebar-tools">
          <p className="admin-tools-label">Common work</p>
          <div className="admin-quick-links" aria-label="Common administrator tasks">
            <Link href="/admin/orders" onClick={() => setMenuOpen(false)}>Orders</Link>
            <Link href="/admin/purchases" onClick={() => setMenuOpen(false)}>Approvals</Link>
            <Link href="/admin/support" onClick={() => setMenuOpen(false)}>Support</Link>
            <Link href="/admin/products" onClick={() => setMenuOpen(false)}>Products</Link>
          </div>
          <label className="admin-nav-search"><span aria-hidden="true">⌕</span><span className="sr-only">Find an administrator page</span><input aria-label="Find an administrator page" onChange={(event) => setNavigationQuery(event.target.value)} placeholder="Find a tool or page…" type="search" value={navigationQuery} /></label>
        </div>
        <nav aria-label="Administrator navigation" className="admin-sidebar-navigation">
          {filteredNavigation.map((group) => {
            const expanded = Boolean(navigationQuery.trim()) || currentGroup?.label === group.label || openGroups.includes(group.label);
            const groupId = `admin-group-${group.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
            return (
            <section className={`admin-navigation-group${currentGroup?.label === group.label ? " has-active-item" : ""}`} key={group.label}>
              <button aria-controls={groupId} aria-expanded={expanded} className="admin-navigation-group-toggle" onClick={() => toggleGroup(group.label)} type="button">
                <span><b>{group.label}</b><small>{group.description}</small></span>
                <em aria-hidden="true">⌄</em>
              </button>
              <div className="admin-navigation-items" hidden={!expanded} id={groupId}>
              {group.items.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <Link aria-current={active ? "page" : undefined} className={active ? "is-active" : undefined} href={item.href} key={item.href} onClick={() => setMenuOpen(false)}>
                    <span aria-hidden="true">{item.icon}</span>
                    <b>{item.label}</b>
                  </Link>
                );
              })}
              </div>
            </section>
          );})}
          {!filteredNavigation.length ? <p className="admin-navigation-empty">No admin page matches “{navigationQuery}”.</p> : null}
        </nav>
        <footer className="admin-sidebar-footer">
          <div><span aria-hidden="true">●</span><p><small>Signed in as</small><b>{adminName}</b></p></div>
          <AdminLogoutButton />
        </footer>
      </aside>
      <div className="admin-workspace-main" id="admin-main-content" tabIndex={-1}>
        <header className="admin-workspace-toolbar">
          <div className="admin-workspace-title">
            <span>{currentGroup?.label ?? "Administration"}</span>
            <b>{currentItem?.label ?? "Workspace"}</b>
            <small>{currentGroup?.description ?? "Manage the DeshDak platform"}</small>
          </div>
          <nav aria-label="Administrator utilities"><Link href="/admin">Overview</Link><Link href="/admin/launch-readiness/setup">Live setup</Link><Link href="/">Storefront <span aria-hidden="true">↗</span></Link></nav>
        </header>
        <aside className="admin-page-guide" aria-label="What you can do on this page">
          <span aria-hidden="true">i</span>
          <p><b>What you can do here</b>{pageGuidance}</p>
        </aside>
        {children}
      </div>
    </div>
  );
}
