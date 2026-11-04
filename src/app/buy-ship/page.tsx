import { redirect } from "next/navigation";
import { AcceptQuoteButton } from "@/components/accept-quote-button";
import { BuyShipForm } from "@/components/buy-ship-form";
import { StartPaymentButton } from "@/components/start-payment-button";
import { CustomerNav } from "@/components/store-header";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { getServerSession } from "@/lib/server-session";

export default async function BuyShipPage() {
  const session = await getServerSession();
  if (!session?.roles.includes(ROLE.CUSTOMER_PERSONAL)) redirect("/login?next=/buy-ship");
  const [requests, wallet] = await Promise.all([
    prisma.sourcingRequest.findMany({ where: { customerId: session.userId }, include: { quotes: { where: { status: { in: ["SENT", "ACCEPTED"] } }, orderBy: { version: "desc" }, take: 1 } }, orderBy: { createdAt: "desc" }, take: 8 }),
    prisma.wallet.findUnique({ where: { userId_currency: { userId: session.userId, currency: "BDT" } }, select: { availableBalance: true } }),
  ]);
  const walletBalance = wallet?.availableBalance.toString() ?? "0.00";
  return <main className="dashboard-shell"><CustomerNav session={session} /><section className="seller-products-content"><p className="eyebrow">BUY & SHIP</p><h1>Request a product from China.</h1><div className="seller-products-grid"><div className="product-form-card"><h2>Paste the product link</h2><p>Send a China product link. Our sourcing team will review availability and prepare a transparent quote.</p><BuyShipForm /></div><div className="product-list-card"><h2>Your recent requests</h2>{requests.length ? <ul>{requests.map((item) => { const quote = item.quotes[0]; return <li className="request-item" key={item.id}><div><strong>{item.productTitle ?? item.reference}</strong><span>Source country: {item.sourceCountryCode === "CN" ? "China" : item.sourceCountryCode}</span></div><b className={`status-${item.status.toLowerCase()}`}>{item.status.replaceAll("_", " ")}</b>{quote ? <div className="customer-quote"><strong>Estimated total: ৳{quote.totalBdt.toString()}</strong>{quote.status === "SENT" ? <><span>Valid until {quote.expiresAt.toLocaleDateString()}</span><AcceptQuoteButton requestId={item.id} /></> : <StartPaymentButton quoteId={quote.id} walletBalance={walletBalance} quoteTotal={quote.totalBdt.toString()} />}</div> : null}</li>; })}</ul> : <p>No Buy & Ship requests yet.</p>}</div></div></section></main>;
}
