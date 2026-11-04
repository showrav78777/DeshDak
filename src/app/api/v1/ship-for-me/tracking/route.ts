import { type NextRequest } from "next/server";
import { z } from "zod";

import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { createReference } from "@/lib/reference";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { createTransactionalNotification } from "@/modules/notifications/service";

const parcelSchema = z.object({ inboundCarrier: z.string().trim().min(2).max(80), inboundTracking: z.string().trim().min(4).max(120).transform((value) => value.toUpperCase()) });
const schema = z.object({ requestId: z.string().uuid(), parcels: z.array(parcelSchema).min(1).max(10).optional(), inboundCarrier: z.string().trim().min(2).max(80).optional(), inboundTracking: z.string().trim().min(4).max(120).optional() }).superRefine((value, context) => {
  if (!value.parcels && (!value.inboundCarrier || !value.inboundTracking)) context.addIssue({ code: "custom", message: "Provide tracking for every parcel." });
});

export async function POST(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session) return apiError("AUTHENTICATION_REQUIRED", "Please sign in to submit inbound tracking.", 401);
  if (!session.roles.includes(ROLE.CUSTOMER_PERSONAL)) return apiError("CUSTOMER_ACCESS_REQUIRED", "A customer account is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "This request must originate from the protected customer application.", 403);
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
  if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 200) return apiError("IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required.", 422);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Check the request, carrier, and tracking number.", 422, z.treeifyError(parsed.error));

  const current = await prisma.shipForMeRequest.findFirst({ where: { id: parsed.data.requestId, customerId: session.userId }, select: { id: true, reference: true, customerId: true, orderId: true, originWarehouseId: true, expectedPackageCount: true, status: true, trackingIdempotencyKey: true, inboundCarrier: true, inboundTracking: true, order: { select: { orderNumber: true, packages: { select: { id: true, packageCode: true, status: true, inboundCarrier: true, inboundTracking: true }, orderBy: { createdAt: "asc" } } } } } });
  if (!current) return apiError("SHIP_FOR_ME_REQUEST_NOT_FOUND", "Ship for Me request was not found.", 404);
  if (current.trackingIdempotencyKey === idempotencyKey && ["TRACKING_SUBMITTED", "PARTIALLY_RECEIVED", "WAREHOUSE_RECEIVED"].includes(current.status)) return apiSuccess({ request: { id: current.id, reference: current.reference, status: current.status, inboundCarrier: current.inboundCarrier, inboundTracking: current.inboundTracking, order: current.order }, idempotentReplay: true, nextAction: current.status === "WAREHOUSE_RECEIVED" ? "VIEW_ORDER_TIMELINE" : "WAIT_FOR_WAREHOUSE_SCAN" }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  if (current.status !== "ADDRESS_ISSUED") return apiError("TRACKING_ALREADY_FINALIZED", "Inbound tracking can no longer be changed online. Contact support if the seller changed it.", 409);
  const parcels = parsed.data.parcels ?? [{ inboundCarrier: parsed.data.inboundCarrier!, inboundTracking: parsed.data.inboundTracking!.toUpperCase() }];
  if (parcels.length !== current.expectedPackageCount) return apiError("PARCEL_COUNT_MISMATCH", `Submit exactly ${current.expectedPackageCount} parcel tracking number${current.expectedPackageCount === 1 ? "" : "s"}.`, 422);
  if (new Set(parcels.map(({ inboundTracking }) => inboundTracking.toUpperCase())).size !== parcels.length) return apiError("DUPLICATE_INBOUND_TRACKING", "Each parcel must have a different inbound tracking number.", 422);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const changed = await tx.shipForMeRequest.updateMany({ where: { id: current.id, customerId: session.userId, status: "ADDRESS_ISSUED", trackingIdempotencyKey: null }, data: { status: "TRACKING_SUBMITTED", inboundCarrier: parcels[0].inboundCarrier, inboundTracking: parcels[0].inboundTracking, trackingIdempotencyKey: idempotencyKey, trackingSubmittedAt: new Date() } });
      if (changed.count !== 1) return null;
      const packages = [];
      for (const parcel of parcels) packages.push(await tx.package.create({ data: { orderId: current.orderId, warehouseId: current.originWarehouseId, packageCode: createReference("PKG"), inboundCarrier: parcel.inboundCarrier, inboundTracking: parcel.inboundTracking, status: "EXPECTED" }, select: { id: true, packageCode: true, status: true, inboundCarrier: true, inboundTracking: true } }));
      await createTransactionalNotification(tx, { userId: session.userId, eventType: "SHIP_FOR_ME_TRACKING_SUBMITTED", title: `Inbound tracking saved · ${current.reference}`, titleBn: `ইনবাউন্ড ট্র্যাকিং সংরক্ষিত · ${current.reference}`, body: "We will publish the next update only after your package is physically scanned at the origin warehouse.", bodyBn: "আপনার পার্সেল উৎস দেশের গুদামে স্ক্যান হওয়ার পরেই পরবর্তী আপডেট প্রকাশ করা হবে।", deepLink: `/ship-for-me/${current.id}`, entityType: "ShipForMeRequest", entityId: current.id, idempotencyKey: `ship-for-me-tracking:${current.id}` });
      await tx.auditLog.create({ data: { actorId: session.userId, action: "ship_for_me.tracking_submitted", entityType: "ShipForMeRequest", entityId: current.id, metadata: { packageIds: packages.map(({ id }) => id), parcelCount: packages.length, carriers: [...new Set(parcels.map(({ inboundCarrier }) => inboundCarrier))] } } });
      return packages;
    }, { isolationLevel: "Serializable" });
    if (!result) return apiError("TRACKING_UPDATE_CONFLICT", "This request changed while tracking was submitted. Refresh to see the latest state.", 409);
    return apiSuccess({ request: { id: current.id, reference: current.reference, status: "TRACKING_SUBMITTED", inboundCarrier: parcels[0].inboundCarrier, inboundTracking: parcels[0].inboundTracking, order: { orderNumber: current.order.orderNumber, packages: result } }, idempotentReplay: false, nextAction: "WAIT_FOR_WAREHOUSE_SCAN" }, { status: 201, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return apiError("TRACKING_UPDATE_CONFLICT", "This tracking request was already processed. Refresh to see the latest state.", 409);
    if ((error as { code?: string }).code === "P2034") return apiError("TRACKING_RETRY_REQUIRED", "The request changed while tracking was saved. Please retry safely.", 409);
    throw error;
  }
}
