import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { getRequestSession } from "@/lib/request-session";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { SupplierOrderRecordError, supplierOrderRecordSelect } from "@/modules/sourcing/supplier-order-records";
import { replaceSupplierRecord, supplierRecordReplacementSchema } from "@/modules/sourcing/supplier-record-replacement";
import { createTransactionalNotification, orderNotification } from "@/modules/notifications/service";

export async function POST(request: NextRequest, context: { params: Promise<{ orderId: string; recordId: string }> }) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN)) return apiError("ADMIN_ACCESS_REQUIRED", "Admin access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "Use the protected Admin application.", 403);
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
  if (!idempotencyKey || !/^[A-Za-z0-9:._-]{16,255}$/.test(idempotencyKey)) return apiError("IDEMPOTENCY_KEY_REQUIRED", "Provide a valid request key.", 422);
  const parsed = supplierRecordReplacementSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Provide the corrected name, reference, variant, latest hold and review reason. Quantities, warehouse and financial changes are not accepted.", 422);
  const { orderId, recordId } = await context.params;
  try {
    const result = await prisma.$transaction(async tx => {
      const saved = await replaceSupplierRecord(tx, { orderId, recordId, actorId: session.userId, idempotencyKey, data: parsed.data });
      if (saved.history) {
        const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { customerId: true } });
        const notification = orderNotification({ userId: order.customerId, orderId, orderNumber: saved.orderNumber!, status: "SOURCING", eventId: saved.history.id, note: saved.history.note! });
        if (notification) await createTransactionalNotification(tx, notification);
      }
      return { record: await tx.supplierOrderRecord.findUniqueOrThrow({ where: { id: saved.recordId }, select: supplierOrderRecordSelect }), replayed: saved.replayed };
    }, { isolationLevel: "Serializable" });
    return apiSuccess(result, { status: result.replayed ? 200 : 201, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    if (error instanceof SupplierOrderRecordError) return apiError(error.code, error.message, 409);
    if (["P2002", "P2034"].includes((error as { code?: string }).code ?? "")) return apiError("RECORD_CONFLICT", "Concurrent change detected. Refresh and review before retrying.", 409);
    throw error;
  }
}
