import Link from "next/link";
import { redirect } from "next/navigation";
import { CustomerNav } from "@/components/store-header";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { getServerSession } from "@/lib/server-session";

const transactionLabels: Record<string, string> = { REFUND_CREDIT: "Refund received", PAYMENT_DEBIT: "Order payment", MANUAL_CREDIT: "Wallet credit", MANUAL_DEBIT: "Wallet debit", HOLD: "Balance held", RELEASE: "Balance released", REVERSAL: "Reversal" };
const credits = new Set(["REFUND_CREDIT", "MANUAL_CREDIT", "RELEASE", "REVERSAL"]);

export default async function WalletPage() {
  const session = await getServerSession();
  if (!session?.roles.includes(ROLE.CUSTOMER_PERSONAL)) redirect("/login?next=/wallet");
  const wallet = await prisma.wallet.findUnique({ where: { userId_currency: { userId: session.userId, currency: "BDT" } }, include: { transactions: { orderBy: { createdAt: "desc" }, take: 100 } } });
  return <main className="dashboard-shell wallet-shell"><CustomerNav session={session} /><section className="wallet-page"><div className="wallet-page-head"><div><p className="eyebrow">MY WALLET</p><h1>Balance and transactions.</h1><p>Approved refunds appear here and can be used securely for future payments.</p></div><Link className="button primary" href="/products">Spend wallet balance</Link></div><div className="wallet-balance-grid"><article className="wallet-balance-card active"><span>Available balance</span><b>৳{wallet?.availableBalance.toString() ?? "0.00"}</b><div><small>Pending: ৳0.00</small><small>Hold: ৳{wallet?.heldBalance.toString() ?? "0.00"}</small></div></article><article className="wallet-balance-card future"><span>Additional currencies</span><b>Admin configurable</b><p>More wallet currencies can be enabled safely when new countries and settlement methods launch.</p></article></div><section className="wallet-transactions"><div className="updates-head"><div><h2>Transactions</h2><p>Every posted credit and debit is immutable and auditable.</p></div><span>{wallet?.transactions.length ?? 0} record{wallet?.transactions.length === 1 ? "" : "s"}</span></div>{wallet?.transactions.length ? <div className="wallet-table-wrap"><table><thead><tr><th>Transaction</th><th>Date & time</th><th>Amount / Type</th><th>Status</th><th>Description</th></tr></thead><tbody>{wallet.transactions.map((transaction) => <tr key={transaction.id}><td><b>{transaction.reference}</b></td><td>{transaction.createdAt.toLocaleString()}</td><td><b className={credits.has(transaction.type) ? "wallet-credit" : "wallet-debit"}>{credits.has(transaction.type) ? "+" : "−"}৳{transaction.amount.toString()}</b><small>{transactionLabels[transaction.type] ?? transaction.type}</small></td><td><span className="status-active">{transaction.status}</span></td><td>{transaction.description}</td></tr>)}</tbody></table></div> : <div className="wallet-empty"><span>▣</span><b>No transactions yet</b><p>Your approved wallet refunds and wallet payments will appear here.</p></div>}</section></section></main>;
}
