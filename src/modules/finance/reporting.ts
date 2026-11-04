import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type FinanceReportWindow = { from: Date; to: Date; currency?: string };

export async function buildFinanceReport(window: FinanceReportWindow) {
  const entryWhere: Prisma.FinancialJournalEntryWhereInput = { journal: { postedAt: { gte: window.from, lte: window.to } }, ...(window.currency ? { currency: window.currency } : {}) };
  const journalWhere: Prisma.FinancialJournalWhereInput = { postedAt: { gte: window.from, lte: window.to }, ...(window.currency ? { currency: window.currency } : {}) };
  const [groupedEntries, journals, walletTotals, paymentGroups, refundGroups, shippingPaymentGroups, totalJournals] = await Promise.all([
    prisma.financialJournalEntry.groupBy({ by: ["accountCode", "currency", "direction"], where: entryWhere, _sum: { amount: true }, _count: { _all: true }, orderBy: [{ currency: "asc" }, { accountCode: "asc" }] }),
    prisma.financialJournal.findMany({ where: journalWhere, include: { entries: { select: { accountCode: true, direction: true, amount: true, currency: true } }, walletTransaction: { select: { reference: true, type: true } } }, orderBy: { postedAt: "desc" }, take: 250 }),
    prisma.wallet.groupBy({ by: ["currency"], ...(window.currency ? { where: { currency: window.currency } } : {}), _sum: { availableBalance: true, heldBalance: true }, _count: { _all: true }, orderBy: { currency: "asc" } }),
    prisma.paymentIntent.groupBy({ by: ["provider", "currency", "status"], where: { createdAt: { gte: window.from, lte: window.to }, ...(window.currency ? { currency: window.currency } : {}) }, _sum: { amount: true }, _count: { _all: true }, orderBy: [{ currency: "asc" }, { provider: "asc" }] }),
    prisma.refund.groupBy({ by: ["currency", "status", "destination"], where: { createdAt: { gte: window.from, lte: window.to }, ...(window.currency ? { currency: window.currency } : {}) }, _sum: { amount: true }, _count: { _all: true }, orderBy: { currency: "asc" } }),
    prisma.shippingPayment.groupBy({ by: ["currency", "status"], where: { createdAt: { gte: window.from, lte: window.to }, ...(window.currency ? { currency: window.currency } : {}) }, _sum: { amount: true }, _count: { _all: true }, orderBy: { currency: "asc" } }),
    prisma.financialJournal.count({ where: journalWhere }),
  ]);

  const accounts = new Map<string, { accountCode: string; currency: string; debit: Prisma.Decimal; credit: Prisma.Decimal; entries: number }>();
  for (const row of groupedEntries) { const key = `${row.currency}:${row.accountCode}`; const current = accounts.get(key) ?? { accountCode: row.accountCode, currency: row.currency, debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(0), entries: 0 }; const amount = row._sum.amount ?? new Prisma.Decimal(0); if (row.direction === "DEBIT") current.debit = current.debit.plus(amount); else current.credit = current.credit.plus(amount); current.entries += row._count._all; accounts.set(key, current); }
  const trialBalance = [...accounts.values()].map((row) => ({ ...row, netDebit: row.debit.minus(row.credit) }));
  const currencyTotals = new Map<string, { currency: string; debit: Prisma.Decimal; credit: Prisma.Decimal }>();
  for (const row of trialBalance) { const total = currencyTotals.get(row.currency) ?? { currency: row.currency, debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(0) }; total.debit = total.debit.plus(row.debit); total.credit = total.credit.plus(row.credit); currencyTotals.set(row.currency, total); }
  const integrityExceptions = journals.flatMap((journal) => { const debit = journal.entries.filter((entry) => entry.direction === "DEBIT").reduce((sum, entry) => sum.plus(entry.amount), new Prisma.Decimal(0)); const credit = journal.entries.filter((entry) => entry.direction === "CREDIT").reduce((sum, entry) => sum.plus(entry.amount), new Prisma.Decimal(0)); const currencies = new Set(journal.entries.map((entry) => entry.currency)); return debit.equals(credit) && currencies.size === 1 && currencies.has(journal.currency) ? [] : [{ id: journal.id, reference: journal.reference, currency: journal.currency, debit, credit, reason: currencies.size !== 1 || !currencies.has(journal.currency) ? "CURRENCY_MISMATCH" : "UNBALANCED" }]; });

  return {
    window: { from: window.from, to: window.to, currency: window.currency ?? null },
    trialBalance,
    currencyTotals: [...currencyTotals.values()].map((row) => ({ ...row, difference: row.debit.minus(row.credit) })),
    integrity: { journalsInspected: journals.length, totalJournals, isSample: totalJournals > journals.length, exceptions: integrityExceptions },
    recentJournals: journals.slice(0, 100).map((journal) => ({ id: journal.id, reference: journal.reference, eventType: journal.eventType, currency: journal.currency, description: journal.description, postedAt: journal.postedAt, entryCount: journal.entries.length, walletTransaction: journal.walletTransaction })),
    walletTotals: walletTotals.map((row) => ({ currency: row.currency, wallets: row._count._all, availableBalance: row._sum.availableBalance ?? 0, heldBalance: row._sum.heldBalance ?? 0 })),
    paymentSummary: paymentGroups.map((row) => ({ provider: row.provider, currency: row.currency, status: row.status, count: row._count._all, amount: row._sum.amount ?? 0 })),
    shippingPaymentSummary: shippingPaymentGroups.map((row) => ({ currency: row.currency, status: row.status, count: row._count._all, amount: row._sum.amount ?? 0 })),
    refundSummary: refundGroups.map((row) => ({ currency: row.currency, status: row.status, destination: row.destination, count: row._count._all, amount: row._sum.amount ?? 0 })),
    externalReconciliation: { status: "NOT_CONNECTED" as const, message: "Gateway settlement ingestion and automated reconciliation are disabled until approved provider adapters are connected." },
  };
}
