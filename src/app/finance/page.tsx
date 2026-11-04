import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminLogoutButton } from "@/components/admin-logout-button";
import { ROLE } from "@/lib/roles";
import { getServerSession } from "@/lib/server-session";

export default async function FinancePage() {
  const session = await getServerSession();
  if (!session?.roles.includes(ROLE.FINANCE) || session.portal !== "finance") redirect("/finance/login");
  return <main className="dashboard-shell"><nav className="site-nav"><Link className="brand" href="/finance"><span className="brand-mark">D</span><span>DeshDak Finance</span></Link><div className="customer-nav-account"><span className="dashboard-user">{session.fullName}</span><AdminLogoutButton redirectTo="/finance/login" /></div></nav><section className="admin-content"><p className="eyebrow">FINANCE OPERATIONS</p><h1>Verified financial controls.</h1><p className="admin-intro">Use only approved evidence. Customer-service decisions, Compliance approval, platform administration, and gateway credentials remain outside this portal.</p><div className="admin-grid"><Link className="dashboard-card" href="/finance/reports"><span>Σ</span><h2>Accounting reports</h2><p>Review trial balances, journal integrity, wallet totals, payment evidence, and refund summaries.</p></Link><Link className="dashboard-card" href="/finance/payment-reconciliation"><span>≋</span><h2>Payment reconciliation</h2><p>Import merchant settlement reports, match exact payments, and investigate exceptions without changing money automatically.</p></Link><Link className="dashboard-card" href="/finance/fx-rates"><span>FX</span><h2>Exchange rates</h2><p>Create versioned drafts, record Finance approval, and activate only after Compliance approval.</p></Link><Link className="dashboard-card" href="/finance/refunds"><span>↩</span><h2>Approved refunds</h2><p>Post wallet refunds using the original FX snapshot, promotion netting, idempotency, and balanced ledger entries.</p></Link></div></section></main>;
}
