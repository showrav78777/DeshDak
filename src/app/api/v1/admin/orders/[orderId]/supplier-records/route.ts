import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { getRequestSession } from "@/lib/request-session";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { supplierRecordPage, supplierRecordPagination } from "@/modules/sourcing/supplier-record-pagination";
import { createSupplierOrderRecord, supplierOrderRecordSchema, supplierOrderRecordSelect, SupplierOrderRecordError } from "@/modules/sourcing/supplier-order-records";

type Context = { params: Promise<{ orderId: string }> };
const privateHeaders = { "Cache-Control": "private, no-store, max-age=0" };
export async function GET(request: NextRequest, context: Context) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN)) return apiError("ADMIN_ACCESS_REQUIRED", "Admin access is required.", 403);
  const pageValues = request.nextUrl.searchParams.getAll("page");
  const page = supplierRecordPage(pageValues.length > 1 ? pageValues : pageValues[0]);
  if (page === null) return apiError("VALIDATION_ERROR", "Use a single page number between 1 and 10000.", 422);
  const { orderId } = await context.params;
  if (!await prisma.order.findUnique({ where: { id: orderId }, select: { id: true } })) return apiError("ORDER_NOT_FOUND", "Order was not found.", 404);
  const result = await prisma.$transaction(async tx => {
    const total = await tx.supplierOrderRecord.count({ where: { orderId } });
    const { skip, ...pagination } = supplierRecordPagination(page, total, 100);
    const records = await tx.supplierOrderRecord.findMany({ where: { orderId }, select: supplierOrderRecordSelect, orderBy: [{ createdAt: "asc" }, { id: "asc" }], skip, take: 100 });
    return { records, pagination };
  }, { isolationLevel: "RepeatableRead" });
  return apiSuccess(result, { headers: privateHeaders });
}
export async function POST(request: NextRequest, context: Context) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN)) return apiError("ADMIN_ACCESS_REQUIRED", "Admin access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "Use the protected Admin application.", 403);
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
  if (!idempotencyKey || !/^[A-Za-z0-9:._-]{16,255}$/.test(idempotencyKey)) return apiError("IDEMPOTENCY_KEY_REQUIRED", "Provide a valid request key.", 422);
  const parsed = supplierOrderRecordSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Provide the supplier reference, exact variant, quantity and origin warehouse. Monetary fields are not accepted here.", 422);
  const { orderId } = await context.params;
  try {
    const result = await prisma.$transaction(async tx => {
      const saved = await createSupplierOrderRecord(tx, { orderId, actorId: session.userId, idempotencyKey, data: parsed.data });
      const record = await tx.supplierOrderRecord.findUniqueOrThrow({ where: { id: saved.recordId }, select: supplierOrderRecordSelect });
      return { record, replayed: saved.replayed };
    }, { isolationLevel: "Serializable" });
    return apiSuccess(result, { status: result.replayed ? 200 : 201, headers: privateHeaders });
  } catch (error) {
    if (error instanceof SupplierOrderRecordError) return apiError(error.code, error.message, error.code === "ORDER_NOT_FOUND" ? 404 : 409);
    if (["P2002", "P2034"].includes((error as { code?: string }).code ?? "")) return apiError("RECORD_CONFLICT", "A duplicate or concurrent change was detected. Refresh and review existing records before retrying.", 409);
    throw error;
  }
}
