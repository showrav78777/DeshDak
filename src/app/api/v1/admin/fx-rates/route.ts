import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";

const optionalDate = z.preprocess((value) => value === "" || value === null || value === undefined ? null : value, z.coerce.date().nullable());
const schema = z.object({
  baseCurrency: z.string().trim().length(3).toUpperCase(),
  quoteCurrency: z.string().trim().length(3).toUpperCase(),
  customerSegment: z.enum(["PERSONAL", "BUSINESS"]),
  marketRate: z.coerce.number().positive().max(1_000_000),
  spreadPercent: z.coerce.number().min(0).max(100),
  source: z.enum(["MANUAL", "PRIMARY_PROVIDER", "FALLBACK_PROVIDER"]),
  sourceReference: z.string().trim().max(160).optional(),
  validFrom: z.coerce.date(),
  validTo: optionalDate,
}).refine((value) => value.baseCurrency !== value.quoteCurrency, { message: "Do not create rates for the same currency; parity is automatic." }).refine((value) => !value.validTo || value.validTo > value.validFrom, { message: "Valid-to must be after valid-from." });

export async function GET(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session || (!session.roles.includes(ROLE.ADMIN) && !session.roles.includes(ROLE.FINANCE))) return apiError("FINANCE_ACCESS_REQUIRED", "Finance access is required.", 403);
  const rates = await prisma.exchangeRate.findMany({ orderBy: [{ createdAt: "desc" }], take: 250 });
  return apiSuccess({ rates }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function POST(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session || (!session.roles.includes(ROLE.ADMIN) && !session.roles.includes(ROLE.FINANCE))) return apiError("FINANCE_ACCESS_REQUIRED", "Finance access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "This financial action must originate from a protected application.", 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Provide a valid currency pair, segment, rate, spread, source, and validity window.", 422, z.treeifyError(parsed.error));
  const rate = await prisma.$transaction(async (tx) => {
    const created = await tx.exchangeRate.create({ data: { ...parsed.data, sourceReference: parsed.data.sourceReference || null, createdById: session.userId, status: "DRAFT", financeApproved: false, complianceApproved: false } });
    await tx.auditLog.create({ data: { actorId: session.userId, action: "exchange_rate.version_created", entityType: "ExchangeRate", entityId: created.id, metadata: { pair: `${created.baseCurrency}_${created.quoteCurrency}`, customerSegment: created.customerSegment, marketRate: created.marketRate.toString(), spreadPercent: created.spreadPercent.toString(), source: created.source, validFrom: created.validFrom.toISOString(), validTo: created.validTo?.toISOString() ?? null } } });
    return created;
  });
  return apiSuccess({ rate }, { status: 201, headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
