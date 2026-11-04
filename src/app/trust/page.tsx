import type { Metadata } from "next";
import Link from "next/link";

import { StoreHeader } from "@/components/store-header";
import { getServerSession } from "@/lib/server-session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Trust Centre",
  description: "Understand DeshDak seller review, order evidence, payment safeguards, claims, privacy, and support boundaries before you transact.",
  alternates: { canonical: "/trust" },
  openGraph: {
    title: "DeshDak Trust Centre",
    description: "Understand DeshDak seller review, order evidence, payment safeguards, claims, privacy, and support boundaries before you transact.",
    url: "/trust",
  },
};

const safeguards = [
  {
    icon: "✓",
    title: "Seller application review",
    body: "A Bangladesh store is not public until an administrator reviews its application. Approval confirms the platform review—not a blanket authenticity guarantee for every item.",
  },
  {
    icon: "◎",
    title: "Separate product moderation",
    body: "Seller approval does not automatically publish products. International availability, category, listing content, measurements and compliance information are reviewed separately.",
  },
  {
    icon: "▦",
    title: "Traceable platform codes",
    body: "Products, orders and warehouse packages receive DeshDak-controlled references. QR, barcode and scan events connect physical handling to the correct operational record.",
  },
  {
    icon: "↻",
    title: "Recorded decisions",
    body: "Quote approval, payment records, order status changes, warehouse events, claims and refunds retain accountable histories instead of being silently overwritten.",
  },
];

const evidenceSteps = [
  ["01", "Before approval", "Review the item, quantity, price basis and available delivery information before accepting a quote or checkout."],
  ["02", "During handling", "Follow confirmed purchasing, warehouse, measurement, shipment, customs, courier and delivery events from your order timeline."],
  ["03", "If something changes", "Important exceptions and revised shipping charges require a recorded update or customer decision; they are not hidden inside the original price."],
  ["04", "If there is a problem", "Open a claim from the relevant delivered order, submit evidence and follow the review, inspection and refund decision in one place."],
];

export default async function TrustCentrePage() {
  const session = await getServerSession();

  return <main className="trust-centre">
    <StoreHeader session={session} />
    <section className="trust-hero">
      <div>
        <p className="eyebrow">CROSSLY TRUST CENTRE</p>
        <h1>Know what happens before you pay.</h1>
        <p>Trust should come from visible rules, recorded evidence and honest limits. See how DeshDak reviews sellers, protects transactions and handles problems.</p>
        <div className="trust-hero-actions">
          <Link className="button primary" href="/products">Browse approved products</Link>
          <a className="button secondary" href="#protection-boundaries">Understand protection</a>
        </div>
      </div>
      <aside aria-label="DeshDak trust principles">
        <span>Our operating principle</span>
        <blockquote>Evidence before decisions. Clear consent before charges. No invented status updates.</blockquote>
        <small>Protection depends on the order type, evidence, claim window and published terms that apply to the transaction.</small>
      </aside>
    </section>

    <nav className="trust-anchor-nav" aria-label="Trust Centre sections">
      <a href="#verification">Verification</a>
      <a href="#tracking">Order evidence</a>
      <a href="#payments">Money</a>
      <a href="#protection-boundaries">Claims</a>
      <a href="#privacy">Privacy</a>
      <a href="#help">Get help</a>
    </nav>

    <section className="trust-content-section" id="verification">
      <div className="trust-section-heading"><p className="eyebrow">VERIFICATION</p><h2>What DeshDak checks—and what approval means.</h2><p>Store and product approval are controlled separately so one successful application cannot bypass product review.</p></div>
      <div className="trust-safeguard-grid">{safeguards.map((item) => <article key={item.title}><i aria-hidden="true">{item.icon}</i><h3>{item.title}</h3><p>{item.body}</p></article>)}</div>
    </section>

    <section className="trust-evidence-section" id="tracking">
      <div className="trust-section-heading"><p className="eyebrow">ORDER EVIDENCE</p><h2>A trackable record from approval to resolution.</h2></div>
      <ol>{evidenceSteps.map(([number, title, body]) => <li key={number}><span>{number}</span><div><h3>{title}</h3><p>{body}</p></div></li>)}</ol>
    </section>

    <section className="trust-money-section" id="payments">
      <div className="trust-section-heading"><p className="eyebrow">MONEY & CONSENT</p><h2>Your records should explain every amount.</h2></div>
      <div className="trust-money-grid">
        <article><b>Before payment</b><p>Available charges and currency information are shown for review. A sourcing quote is versioned and expires instead of changing silently after acceptance.</p></article>
        <article><b>After payment</b><p>Orders retain payment, promotional discount and locked exchange-rate evidence so an approved refund can be calculated from the original transaction.</p></article>
        <article><b>Wallet boundary</b><p>The DeshDak wallet is an account balance for supported spending and refunds. It is not presented as a bank deposit or an unlicensed escrow service.</p></article>
        <article><b>Provider confirmation</b><p>An external payment or refund is never reported as completed from a browser redirect alone. DeshDak waits for verified provider confirmation and reconciliation.</p></article>
      </div>
    </section>

    <section className="trust-protection-section" id="protection-boundaries">
      <div className="trust-section-heading"><p className="eyebrow">PROTECTION BOUNDARIES</p><h2>Protection follows the service you choose.</h2><p>These summaries explain the operating distinction. The final terms shown for your transaction control eligibility and outcome.</p></div>
      <div className="trust-protection-grid">
        <article>
          <span>DeshDak sources the product</span>
          <h3>Buy & Ship</h3>
          <p>Eligible claims may cover non-delivery, significant product mismatch and damage before delivery. Clear evidence is required, and exclusions still apply.</p>
          <ul><li>Product and delivery claim workflow</li><li>Warehouse and shipment evidence</li><li>Full or partial refund based on the reviewed outcome</li></ul>
        </article>
        <article>
          <span>You purchased from another seller</span>
          <h3>Ship for Me</h3>
          <p>DeshDak handles shipping and warehouse custody. Product quality, wrong-item or not-as-described disputes remain between you and the original seller.</p>
          <ul><li>Loss or damage protection begins after origin-warehouse receipt and scan</li><li>Shipment-level evidence and investigation</li><li>No implied guarantee of the external seller&apos;s product</li></ul>
        </article>
      </div>
      <div className="trust-deadline-note"><b>Claim timing matters</b><p>For a delivered shipment, open a claim within 7 calendar days of its recorded delivery. For non-delivery, report the problem before or within 7 days after the maximum estimated delivery window. Each shipment has its own deadline.</p></div>
    </section>

    <section className="trust-privacy-section" id="privacy">
      <div><p className="eyebrow">ACCOUNT & PRIVACY</p><h2>Only the access needed for the work.</h2><p>DeshDak uses protected sessions, server-side role checks, audit records and additional verification for sensitive operations. Account activity and personal records are not public.</p></div>
      <dl>
        <div><dt>Data purpose</dt><dd>Ordering, delivery, support, security and consented improvement.</dd></div>
        <div><dt>Analytics choice</dt><dd>Optional analytics activity is controlled from the customer dashboard.</dd></div>
        <div><dt>Session control</dt><dd>Customers can review and revoke their active signed-in devices.</dd></div>
        <div><dt>Data selling</dt><dd>DeshDak policy does not permit selling customer personal data.</dd></div>
      </dl>
    </section>

    <section className="trust-help-section" id="help">
      <div><p className="eyebrow">QUESTIONS OR A PROBLEM?</p><h2>Keep the conversation attached to your account.</h2><p>Signed-in support keeps messages, evidence and operational decisions connected to the correct customer and order.</p></div>
      <div>{session ? <Link className="button primary" href="/support">Open support</Link> : <Link className="button primary" href="/login?next=/support">Sign in for support</Link>}<Link className="button secondary" href="/rmas">View claims</Link></div>
      <small>Official company contact details, final legal terms and external complaint information must be approved and published before production launch.</small>
    </section>
  </main>;
}
