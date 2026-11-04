import Link from "next/link";
import { redirect } from "next/navigation";
import { PaymentMethodAvailabilityForm, PaymentMethodCreateForm, PaymentMethodToggle } from "@/components/payment-method-management";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { getServerSession } from "@/lib/server-session";
import { getPaymentAdapterOptions } from "@/modules/payments/registry";

export const dynamic = "force-dynamic";

export default async function AdminPaymentMethodsPage() {
  const session = await getServerSession();
  if (!session?.roles.includes(ROLE.ADMIN)) redirect("/");
  const [methods, countries] = await Promise.all([
    prisma.paymentMethod.findMany({ include: { countryAvailability: { include: { country: { select: { id: true, isoCode: true, name: true } } }, orderBy: [{ country: { name: "asc" } }, { customerCurrency: "asc" }] } }, orderBy: { displayName: "asc" } }),
    prisma.country.findMany({ orderBy: [{ isActive: "desc" }, { name: "asc" }], select: { id: true, isoCode: true, name: true, defaultCurrency: true, isActive: true } }),
  ]);
  const adapters = getPaymentAdapterOptions();
  return <main className="dashboard-shell"><nav className="site-nav"><Link className="brand" href="/admin"><span className="brand-mark">D</span><span>DeshDak Admin</span></Link><span className="dashboard-user">{session.fullName}</span></nav><section className="admin-content"><p className="eyebrow">FINANCIAL CONFIGURATION</p><h1>Payment methods by country.</h1><p className="admin-intro">Methods remain hidden from checkout until the runtime adapter, country, currency, refunds, reconciliation, Finance, and Compliance are ready. Credentials belong in the production secret manager—not in this page.</p><div className="country-config-grid payment-config-grid"><section className="country-create-card"><h2>Add payment method</h2><p>Create an inactive method linked to a reviewed backend adapter.</p><PaymentMethodCreateForm adapters={adapters} /></section><section className="country-list-card"><h2>Configured methods</h2>{methods.length ? <div className="payment-method-list">{methods.map((method) => { const adapter = adapters.find((item) => item.code === method.adapterCode); return <article key={method.id}><div className="payment-method-head"><div><b>{method.displayName}</b><span>{method.code} · {method.kind.replaceAll("_", " ")} · settles in {method.settlementCurrency}</span><small>{adapter?.runtimeConfigured ? "Runtime credential detected" : "Runtime credential not connected"} · {method.secretReference ? "secret reference recorded" : "no secret reference"}</small></div><div><em className={method.isActive ? "status-active" : "status-inactive"}>{method.isActive ? "Active" : "Inactive"}</em><PaymentMethodToggle methodId={method.id} isActive={method.isActive} /></div></div><div className="payment-availability-list">{method.countryAvailability.map((availability) => <p key={availability.id}><b>{availability.country.name} · {availability.customerCurrency}</b><span>{availability.checkoutEnabled ? "Checkout open" : "Checkout gated"} · F:{availability.financeApproved ? "✓" : "—"} C:{availability.complianceApproved ? "✓" : "—"} R:{availability.refundsApproved ? "✓" : "—"} Rec:{availability.reconciliationApproved ? "✓" : "—"}</span></p>)}</div><PaymentMethodAvailabilityForm methodId={method.id} countries={countries} /></article>; })}</div> : <p className="empty-copy">No method exists yet. Add one as inactive, connect its runtime credential, then complete country readiness.</p>}</section></div></section></main>;
}
