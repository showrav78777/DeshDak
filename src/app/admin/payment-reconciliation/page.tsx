import { redirect } from "next/navigation";
import { PaymentReconciliationView } from "@/components/payment-reconciliation-view";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { getServerSession } from "@/lib/server-session";

export const dynamic = "force-dynamic";
export default async function AdminPaymentReconciliationPage() {
  const session = await getServerSession();
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") redirect("/admin/login");
  const batches = await prisma.paymentSettlementBatch.findMany({ include: { importedBy: { select: { fullName: true } }, entries: { where: { matchStatus: { not: "MATCHED" } }, include: { resolutionProposals: { include: { proposedBy: { select: { fullName: true } }, decision: { include: { reviewedBy: { select: { fullName: true } } } } }, orderBy: { proposedAt: "desc" } } }, orderBy: { rowNumber: "asc" }, take: 100 } }, orderBy: { importedAt: "desc" }, take: 100 });
  return <PaymentReconciliationView batches={batches} viewerId={session.userId} />;
}
