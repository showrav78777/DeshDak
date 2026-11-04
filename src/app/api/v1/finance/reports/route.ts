import { type NextRequest, NextResponse } from "next/server";
import { createReportPdf } from "@/lib/report-pdf";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { buildFinanceReport } from "@/modules/finance/reporting";

const schema = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional(), currency: z.string().trim().length(3).toUpperCase().optional() });

export async function GET(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.FINANCE) || session.portal !== "finance") return apiError("FINANCE_ACCESS_REQUIRED", "MFA-verified Finance access is required.", 403);
  const parsed = schema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Check the report dates and currency.", 422);
  const to = parsed.data.to ?? new Date(); const from = parsed.data.from ?? new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (from >= to || to.getTime() - from.getTime() > 366 * 24 * 60 * 60 * 1000) return apiError("REPORT_WINDOW_INVALID", "Choose a report window of no more than 366 days.", 422);
  const report = await buildFinanceReport({ from, to, currency: parsed.data.currency });
  if (request.nextUrl.searchParams.get("format") === "pdf") {
    const bytes = await createReportPdf("Finance report", [
      `Window: ${from.toISOString()} to ${to.toISOString()}`, `Currency: ${parsed.data.currency ?? "All currencies (reported separately)"}`,
      "Trial balance", ...report.trialBalance.map(row => `${row.accountCode} | ${row.currency} | Debit ${row.debit.toFixed(2)} | Credit ${row.credit.toFixed(2)} | Net debit ${row.netDebit.toFixed(2)}`),
      "Journal totals", ...report.currencyTotals.map(row => `${row.currency} | Debit ${row.debit.toFixed(2)} | Credit ${row.credit.toFixed(2)} | Difference ${row.difference.toFixed(2)}`),
      `Integrity review: ${report.integrity.journalsInspected} of ${report.integrity.totalJournals} journals inspected; ${report.integrity.exceptions.length} exceptions.${report.integrity.isSample ? " Results cover a sample only." : ""}`,
      "Product payments (current status; grouped by creation date)", ...report.paymentSummary.map(row => `${row.currency} ${row.amount.toFixed(2)} | ${row.status} | Count ${row.count}`),
      "Shipping payments (current status; grouped by creation date)", ...report.shippingPaymentSummary.map(row => `${row.currency} ${row.amount.toFixed(2)} | ${row.status} | Count ${row.count}`),
      "Refunds", ...report.refundSummary.map(row => `${row.currency} ${row.amount.toFixed(2)} | ${row.status} | ${row.destination} | Count ${row.count}`),
      "Recent journal evidence (up to 100)", ...report.recentJournals.map(row => `${row.reference} | ${row.currency} | ${row.eventType} | ${row.postedAt.toISOString()}`),
      "External bank and gateway reconciliation must be verified separately. This report is not a tax invoice.",
    ]);
    await import("@/lib/prisma").then(({ prisma }) => prisma.auditLog.create({ data: { actorId: session.userId, action: "finance.report_downloaded", entityType: "FinanceReport", entityId: "window", metadata: { from: from.toISOString(), to: to.toISOString(), currency: parsed.data.currency ?? "ALL", format: "PDF" } } }));
    return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": "attachment; filename=duar-finance-report.pdf", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  }
  return apiSuccess(report, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
