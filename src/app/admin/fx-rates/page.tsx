import Link from "next/link";
import { redirect } from "next/navigation";
import { FxRateCreateForm, FxRateWorkflow } from "@/components/fx-rate-management";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { getServerSession } from "@/lib/server-session";

export const dynamic = "force-dynamic";

export default async function AdminFxRatesPage() {
  const session = await getServerSession();
  if (!session?.roles.includes(ROLE.ADMIN)) redirect("/");
  const [rates, countries] = await Promise.all([prisma.exchangeRate.findMany({ orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 250 }), prisma.country.findMany({ select: { defaultCurrency: true } })]);
  const currencies = [...new Set(["BDT", "USD", "EUR", "GBP", "AED", ...countries.map((country) => country.defaultCurrency)])].sort();
  return <main className="dashboard-shell"><nav className="site-nav"><Link className="brand" href="/admin"><span className="brand-mark">D</span><span>DeshDak Admin</span></Link><span className="dashboard-user">{session.fullName}</span></nav><section className="admin-content"><p className="eyebrow">FINANCIAL CONFIGURATION</p><h1>Exchange-rate versions.</h1><p className="admin-intro">Create, approve, and activate versioned customer rates. Active financial history is never edited: replacing a rate revokes the old version, while every payment keeps its own locked snapshot. Raw provider credentials never belong here.</p><div className="country-config-grid payment-config-grid"><section className="country-create-card"><h2>Create rate draft</h2><p>Rates convert one unit of base currency into customer currency. Parity pairs are automatic.</p><FxRateCreateForm currencies={currencies} /></section><section className="country-list-card"><h2>Rate history</h2>{rates.length ? <div className="payment-method-list">{rates.map((rate) => <article key={rate.id}><div className="payment-method-head"><div><b>{rate.baseCurrency} → {rate.quoteCurrency} · {rate.customerSegment}</b><span>Market {rate.marketRate.toString()} · spread {rate.spreadPercent.toString()}%</span><small>{rate.source.replaceAll("_", " ")} · valid {rate.validFrom.toLocaleString()} → {rate.validTo?.toLocaleString() ?? "until revoked"}</small><small>Finance {rate.financeApproved ? "✓" : "—"} · Compliance {rate.complianceApproved ? "✓" : "—"}</small></div><div><em className={rate.status === "ACTIVE" ? "status-active" : "status-inactive"}>{rate.status}</em><FxRateWorkflow rateId={rate.id} status={rate.status} financeApproved={rate.financeApproved} complianceApproved={rate.complianceApproved} /></div></div></article>)}</div> : <p className="empty-copy">No exchange-rate version exists yet. BDT-to-BDT parity still works automatically.</p>}</section></div></section></main>;
}
