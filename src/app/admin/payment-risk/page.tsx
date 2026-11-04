import { redirect } from "next/navigation";
import { PaymentRiskDecisionForm } from "@/components/payment-risk-decision-form";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { getServerSession } from "@/lib/server-session";

export const dynamic = "force-dynamic";

type Evidence = { validationId?: string; providerStatus?: string; riskTitle?: string | null };
function evidence(payload: unknown): Evidence {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !("evidence" in payload)) return {};
  const value = payload.evidence;
  return value && typeof value === "object" && !Array.isArray(value) ? value as Evidence : {};
}
function customer(payment: { order: { orderNumber: string; customer: { fullName: string; email: string } } | null; sourcingQuote: { sourcingRequest: { reference: string; customer: { fullName: string; email: string } } } | null }) {
  return payment.order ? { target: payment.order.orderNumber, ...payment.order.customer } : payment.sourcingQuote ? { target: payment.sourcingQuote.sourcingRequest.reference, ...payment.sourcingQuote.sourcingRequest.customer } : { target: "Unlinked", fullName: "Unknown", email: "Unknown" };
}

export default async function AdminPaymentRiskPage() {
  const session = await getServerSession();
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") redirect("/admin/login");
  const relation = { order: { select: { orderNumber: true, customer: { select: { fullName: true, email: true } } } }, sourcingQuote: { select: { sourcingRequest: { select: { reference: true, customer: { select: { fullName: true, email: true } } } } } } } as const;
  const [openCases, decisions] = await Promise.all([
    prisma.paymentIntent.findMany({ where: { provider: "SSLCOMMERZ", status: "PENDING", riskDecision: null, gatewayPayload: { path: ["reviewRequired"], equals: true } }, include: relation, orderBy: { updatedAt: "asc" }, take: 100 }),
    prisma.paymentRiskDecision.findMany({ include: { reviewedBy: { select: { fullName: true } }, paymentIntent: { include: relation } }, orderBy: { reviewedAt: "desc" }, take: 100 }),
  ]);
  return <main className="dashboard-shell"><section className="admin-content payment-risk-page"><p className="eyebrow">PAYMENT INVESTIGATION</p><h1>Review held payments.</h1><p className="admin-intro">SSLCommerz validated these transactions but marked them for risk review. Approval releases the order; rejection preserves the payment as financially unresolved until Finance completes refund or settlement investigation. Every decision is permanent and audited.</p><div className="payment-risk-summary"><article><b>{openCases.length}</b><span>Awaiting decision</span></article><article><b>{decisions.filter((item) => item.decision === "APPROVED").length}</b><span>Recently approved</span></article><article><b>{decisions.filter((item) => item.decision === "REJECTED").length}</b><span>Needs financial resolution</span></article></div><section className="payment-risk-section"><h2>Open risk cases</h2>{openCases.length ? <div className="seller-review-list">{openCases.map((payment) => { const proof = evidence(payment.gatewayPayload); const owner = customer(payment); return <article className="seller-review-card" key={payment.id}><div><span className="status-inactive">Held for review</span><h2>{payment.reference}</h2><dl><div><dt>Customer</dt><dd>{owner.fullName}<br />{owner.email}</dd></div><div><dt>Order or request</dt><dd>{owner.target}</dd></div><div><dt>Amount</dt><dd>{payment.currency} {payment.amount.toString()}</dd></div><div><dt>Provider status</dt><dd>{proof.providerStatus ?? "Validated"}</dd></div><div><dt>Risk reason</dt><dd>{proof.riskTitle ?? "Provider requested manual review"}</dd></div><div><dt>Validation reference</dt><dd>{proof.validationId ?? "Recorded privately"}</dd></div></dl></div><PaymentRiskDecisionForm paymentId={payment.id} /></article>; })}</div> : <p className="empty-copy">No validated SSLCommerz payment is waiting for risk review.</p>}</section><section className="payment-risk-section"><h2>Immutable decision history</h2>{decisions.length ? <div className="payment-risk-history">{decisions.map((item) => { const owner = customer(item.paymentIntent); return <article key={item.id}><div><b>{item.paymentIntent.reference}</b><span>{owner.target} · {item.currencySnapshot} {item.amountSnapshot.toString()}</span></div><em className={item.decision === "APPROVED" ? "status-active" : "status-inactive"}>{item.decision}</em><p>{item.reason}</p><small>{item.reviewedBy.fullName} · {item.reviewedAt.toLocaleString("en-BD", { timeZone: "Asia/Dhaka" })}</small></article>; })}</div> : <p className="empty-copy">No risk decision has been recorded.</p>}</section></section></main>;
}
