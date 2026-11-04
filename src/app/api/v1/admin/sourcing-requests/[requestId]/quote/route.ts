import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";

const optionalPositiveNumber = z.preprocess((value) => value === "" || value === undefined ? undefined : value, z.coerce.number().positive().optional());
const schema = z.object({ productCostBdt: z.coerce.number().positive(), serviceFeeBdt: z.coerce.number().min(0), originDeliveryBdt: z.coerce.number().min(0).default(0), estimatedShippingBdt: z.coerce.number().min(0), declaredWeightGrams: z.coerce.number().int().positive(), fxRate: optionalPositiveNumber, note: z.string().trim().max(1000).optional(), expiresAt: z.string().datetime() });

export async function POST(request: NextRequest, context: { params: Promise<{ requestId: string }> }) {
  const session = await getRequestSession(request);
  const isAgent = session?.portal === "sourcing" && session.roles.includes(ROLE.SOURCING_AGENT);
  if (!session || !isAgent) return apiError("SOURCING_ACCESS_REQUIRED", "Sourcing Agent access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "This quote action must originate from a protected application.", 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Please check the quote values.", 422);
  const expiresAt = new Date(parsed.data.expiresAt);
  if (expiresAt <= new Date()) return apiError("QUOTE_EXPIRY_INVALID", "The quote expiry must be in the future.", 422);
  const { requestId } = await context.params;
  try {
    const result = await prisma.$transaction(async (tx) => {
    const sourcingRequest = await tx.sourcingRequest.findUnique({ where: { id: requestId }, select: { id: true, status: true } });
    if (!sourcingRequest || ["CANCELLED", "DECLINED", "APPROVED", "QUOTED"].includes(sourcingRequest.status)) return null;
    if (isAgent && sourcingRequest.status !== "SUBMITTED") return null;
    if (await tx.sourcingQuote.findFirst({ where: { sourcingRequestId: requestId, status: "DRAFT" }, select: { id: true } })) return null;
    const latest = await tx.sourcingQuote.aggregate({ where: { sourcingRequestId: requestId }, _max: { version: true } });
    const totalBdt = parsed.data.productCostBdt + parsed.data.serviceFeeBdt + parsed.data.originDeliveryBdt + parsed.data.estimatedShippingBdt;
    const quote = await tx.sourcingQuote.create({ data: { sourcingRequestId: requestId, version: (latest._max.version ?? 0) + 1, productCostBdt: parsed.data.productCostBdt, serviceFeeBdt: parsed.data.serviceFeeBdt, originDeliveryBdt: parsed.data.originDeliveryBdt, estimatedShippingBdt: parsed.data.estimatedShippingBdt, declaredWeightGrams: parsed.data.declaredWeightGrams, totalBdt, fxRate: parsed.data.fxRate, note: parsed.data.note, expiresAt, status: "DRAFT", createdById: session.userId } });
    await tx.sourcingRequest.update({ where: { id: requestId }, data: { status: "UNDER_REVIEW" } });
    await tx.auditLog.create({ data: { actorId: session.userId, action: "sourcing_quote.draft_submitted", entityType: "SourcingQuote", entityId: quote.id, metadata: { requestId, version: quote.version, originDeliveryBdt: parsed.data.originDeliveryBdt, totalBdt } } });
    return quote;
    }, { isolationLevel: "Serializable" });
    if (!result) return apiError("REQUEST_NOT_QUOTABLE", "This request cannot receive a quote.", 409);
    return apiSuccess({ quote: result }, { status: 201 });
  } catch (error) {
    if (["P2002", "P2034"].includes((error as { code?: string }).code ?? "")) return apiError("SOURCING_DRAFT_RETRY_REQUIRED", "Another agent changed this request. Refresh the queue before retrying.", 409);
    throw error;
  }
}
