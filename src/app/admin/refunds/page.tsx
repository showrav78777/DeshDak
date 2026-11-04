import Link from "next/link";
import { Prisma } from "@prisma/client";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { WalletRefundForm } from "@/components/wallet-refund-form";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

export default async function AdminRefundsPage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;
  if (!session?.roles.includes(ROLE.ADMIN)) redirect("/");

  const [orders, recentRefunds, approvedRmas] = await Promise.all([
    prisma.order.findMany({ where: { paymentIntent: { status: "SUCCEEDED" } }, include: { customer: { select: { fullName: true } }, paymentIntent: { include: { fxSnapshot: true } }, refunds: { where: { status: { in: ["PENDING_APPROVAL", "APPROVED", "SUCCEEDED"] } }, select: { amount: true, requestedBaseAmount: true, promotionNettingBaseAmount: true, netBaseAmount: true } } }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.refund.findMany({ include: { order: { select: { orderNumber: true } }, wallet: { include: { user: { select: { fullName: true } } } } }, orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.rma.findMany({ where: { status: "INSPECTED", decision: { in: ["FULL_REFUND", "PARTIAL_REFUND"] }, approvedRefundAmount: { not: null }, refunds: { none: { status: { in: ["PENDING_APPROVAL", "APPROVED", "SUCCEEDED"] } } } }, select: { id: true, reference: true, orderId: true, reason: true, approvedRefundAmount: true } }),
  ]);

  const refundable = orders.flatMap((order) => {
    const payment = order.paymentIntent!;
    const paidBase = payment.fxSnapshot?.baseAmount ?? (order.currency === payment.currency ? payment.amount : null);
    if (!paidBase) return [];
    const grossOrder = paidBase.plus(order.discountTotal);
    const prior = order.refunds.reduce((total, refund) => {
      const promotion = refund.promotionNettingBaseAmount ?? new Prisma.Decimal(0);
      const net = refund.netBaseAmount ?? refund.amount.mul(paidBase).div(payment.amount).toDecimalPlaces(2);
      return { gross: total.gross.plus(refund.requestedBaseAmount ?? net.plus(promotion)), settlement: total.settlement.plus(refund.amount) };
    }, { gross: new Prisma.Decimal(0), settlement: new Prisma.Decimal(0) });
    const grossRemaining = grossOrder.minus(prior.gross);
    const settlementRemaining = payment.amount.minus(prior.settlement);
    if (!grossRemaining.isPositive() || !settlementRemaining.isPositive()) return [];
    return [{ id: order.id, orderId: order.id, label: `${order.orderNumber} — ${order.customer.fullName} — ${payment.provider}`, grossRemaining: grossRemaining.toFixed(2), settlementRemaining: settlementRemaining.toFixed(2), baseCurrency: order.currency, settlementCurrency: payment.currency, provider: payment.provider }];
  });
  const refundableByOrder = new Map(refundable.map((item) => [item.orderId, item]));
  const claimRefunds = approvedRmas.flatMap((rma) => { const order = refundableByOrder.get(rma.orderId); if (!order || !rma.approvedRefundAmount || rma.approvedRefundAmount.greaterThan(order.grossRemaining)) return []; return [{ ...order, id: `rma:${rma.id}`, rmaId: rma.id, approvedGross: rma.approvedRefundAmount.toFixed(2), approvedReason: `Approved claim ${rma.reference}: ${rma.reason.replaceAll("_", " ")}`, label: `${rma.reference} — approved claim` }]; });
  const refundOptions = [...claimRefunds, ...refundable];

  return <main className="dashboard-shell"><nav className="site-nav"><Link className="brand" href="/admin"><span className="brand-mark">D</span><span>DeshDak Admin</span></Link><span className="dashboard-user">{session.fullName}</span></nav><section className="admin-content"><p className="eyebrow">CONTROLLED REFUNDS</p><h1>Calculate approved refunds from original payment evidence.</h1><p className="admin-intro">The server nets the order&apos;s promotional discount, converts with the original locked FX snapshot, prevents over-refunds and changed idempotent retries, and posts a balanced wallet journal. External payments require recorded customer consent before wallet credit.</p><div className="country-config-grid"><section className="country-create-card"><h2>Calculate and post a wallet refund</h2><p>Enter the approved gross claim amount before promotional discount. The financial engine—not the browser—calculates the payable refund.</p><WalletRefundForm orders={refundOptions} /></section><section className="country-list-card"><h2>Recent refunds</h2>{recentRefunds.length ? <div className="country-list">{recentRefunds.map((refund) => <article key={refund.id}><div><b>{refund.reference} · {refund.currency} {refund.amount.toString()}</b><span>{refund.wallet?.user.fullName ?? "Customer"} · {refund.order.orderNumber}</span><small>{refund.requestedBaseAmount ? `Gross ${refund.baseCurrency} ${refund.requestedBaseAmount.toString()} − promotion ${refund.promotionNettingBaseAmount?.toString() ?? "0.00"} = net ${refund.netBaseAmount?.toString() ?? "—"}` : "Legacy refund calculation evidence"} · {refund.reason}</small></div><em className="status-active">{refund.status}</em></article>)}</div> : <p className="empty-copy">No refund has been posted.</p>}</section></div></section></main>;
}
