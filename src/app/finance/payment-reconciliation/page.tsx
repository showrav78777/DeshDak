import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminLogoutButton } from "@/components/admin-logout-button";
import { PaymentReconciliationView } from "@/components/payment-reconciliation-view";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { getServerSession } from "@/lib/server-session";

export const dynamic = "force-dynamic";
export default async function FinancePaymentReconciliationPage() {
  const session = await getServerSession();
  if (!session?.roles.includes(ROLE.FINANCE) || session.portal !== "finance") redirect("/finance/login");
  const batches = await prisma.paymentSettlementBatch.findMany({ include: { importedBy: { select: { fullName: true } }, entries: { where: { matchStatus: { not: "MATCHED" } }, include: { resolutionProposals: { include: { proposedBy: { select: { fullName: true } }, decision: { include: { reviewedBy: { select: { fullName: true } } } } }, orderBy: { proposedAt: "desc" } } }, orderBy: { rowNumber: "asc" }, take: 100 } }, orderBy: { importedAt: "desc" }, take: 100 });
  return <main className="dashboard-shell"><nav className="site-nav"><Link className="brand" href="/finance"><span className="brand-mark">D</span><span>DeshDak Finance</span></Link><div className="customer-nav-account"><span className="dashboard-user">{session.fullName}</span><AdminLogoutButton redirectTo="/finance/login" /></div></nav><PaymentReconciliationView batches={batches} viewerId={session.userId} /></main>;
}
