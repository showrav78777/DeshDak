import { Prisma } from "@prisma/client";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { createReference } from "@/lib/reference";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { createPlatformCode } from "@/modules/identifiers/service";
import { createTransactionalNotification } from "@/modules/notifications/service";
import { screenRestrictedGoods } from "@/modules/compliance/restricted-goods";

const requestSchema = z.object({
  sourceCountryCode: z.string().trim().length(2).toUpperCase().default("CN"),
  itemDescription: z.string().trim().min(3).max(250),
  expectedPackageCount: z.coerce.number().int().min(1).max(10).default(1),
  declaredValue: z.coerce.number().positive().max(9_999_999).optional(),
  declaredCurrency: z.string().trim().length(3).toUpperCase().optional(),
  customerNote: z.string().trim().max(1000).optional(),
});

const requestSelect = {
  id: true, reference: true, status: true, itemDescription: true, expectedPackageCount: true,
  declaredValue: true, declaredCurrency: true, customerNote: true, warehouseAddress: true,
  inboundCarrier: true, inboundTracking: true, trackingSubmittedAt: true, warehouseReceivedAt: true,
  policyVersion: true, createdAt: true,
  order: { select: { id: true, orderNumber: true, status: true, originCountryCode: true, destinationCountryCode: true, packages: { select: { id: true, packageCode: true, status: true, inboundCarrier: true, inboundTracking: true }, orderBy: { createdAt: "asc" } } } },
  shippingLane: { select: { name: true, originCountry: { select: { isoCode: true, name: true } }, destinationCountry: { select: { isoCode: true, name: true } } } },
} satisfies Prisma.ShipForMeRequestSelect;

function customerAccess(session: Awaited<ReturnType<typeof getRequestSession>>) {
  return session?.roles.includes(ROLE.CUSTOMER_PERSONAL);
}

export async function GET(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session) return apiError("AUTHENTICATION_REQUIRED", "Please sign in to view Ship for Me requests.", 401);
  if (!customerAccess(session)) return apiError("CUSTOMER_ACCESS_REQUIRED", "A customer account is required.", 403);
  const requests = await prisma.shipForMeRequest.findMany({ where: { customerId: session.userId }, select: requestSelect, orderBy: { createdAt: "desc" }, take: 50 });
  return apiSuccess({ requests }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function POST(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session) return apiError("AUTHENTICATION_REQUIRED", "Please sign in to request a warehouse address.", 401);
  if (!customerAccess(session)) return apiError("CUSTOMER_ACCESS_REQUIRED", "A customer account is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "This request must originate from the protected customer application.", 403);
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
  if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 200) return apiError("IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required.", 422);
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Check the shipment description and declared details.", 422, z.treeifyError(parsed.error));
  if (Boolean(parsed.data.declaredValue) !== Boolean(parsed.data.declaredCurrency)) return apiError("DECLARED_VALUE_INCOMPLETE", "Provide both declared value and currency, or leave both empty.", 422);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const replay = await tx.shipForMeRequest.findUnique({ where: { idempotencyKey }, select: { customerId: true, ...requestSelect } });
      if (replay) return replay.customerId === session.userId ? { request: replay, replay: true } : null;
      const lane = await tx.shippingLane.findFirst({
        where: { isActive: true, checkoutEnabled: true, financeApproved: true, complianceApproved: true, operationsApproved: true, originCountry: { is: { isoCode: parsed.data.sourceCountryCode, isActive: true } }, destinationCountry: { is: { isoCode: "BD", isActive: true } } },
        select: { id: true, name: true, originCountry: { select: { isoCode: true, name: true } }, destinationCountry: { select: { isoCode: true, name: true } } }, orderBy: { name: "asc" },
      });
      if (!lane) return null;
      const warehouse = await tx.warehouse.findFirst({ where: { type: "ORIGIN", country: lane.originCountry.isoCode, address: { not: null } }, select: { id: true, name: true, country: true, address: true }, orderBy: { createdAt: "asc" } });
      if (!warehouse?.address) return null;
      const compliance = await screenRestrictedGoods(tx, { subject: "SHIP_FOR_ME", customerId: session.userId, originCountryCode: lane.originCountry.isoCode, destinationCountryCode: lane.destinationCountry.isoCode, text: [parsed.data.itemDescription, parsed.data.customerNote] });
      if (!compliance.allowed) {
        await tx.auditLog.create({ data: { actorId: session.userId, action: compliance.outcome === "BLOCKED" ? "compliance.ship_for_me_blocked" : "compliance.ship_for_me_review_required", entityType: "ComplianceScreeningAttempt", entityId: compliance.attempt.id, metadata: { matchedRuleCodes: compliance.attempt.matchedRuleCodes, sourceCountryCode: lane.originCountry.isoCode, destinationCountryCode: lane.destinationCountry.isoCode } } });
        return { compliance, request: null, replay: false };
      }
      const reference = createReference("SFM");
      const order = await tx.order.create({ data: { orderNumber: createPlatformCode("ORDER"), customerId: session.userId, type: "SHIP_FOR_ME", status: "DRAFT", currency: "BDT", grandTotal: 0, originCountryCode: lane.originCountry.isoCode, destinationCountryCode: lane.destinationCountry.isoCode, shippingLaneId: lane.id, statusHistory: { create: { toStatus: "DRAFT", actorId: session.userId, note: `Ship for Me warehouse address issued with reference ${reference}.` } } }, select: { id: true } });
      const warehouseAddress = { warehouseName: warehouse.name, countryCode: warehouse.country, address: warehouse.address, recipient: `DeshDak ${reference}`, customerReference: reference, instructions: `Put ${reference} on the seller's recipient name, address label, and parcel.` };
      const created = await tx.shipForMeRequest.create({ data: { reference, idempotencyKey, customerId: session.userId, orderId: order.id, originWarehouseId: warehouse.id, shippingLaneId: lane.id, itemDescription: parsed.data.itemDescription, expectedPackageCount: parsed.data.expectedPackageCount, declaredValue: parsed.data.declaredValue, declaredCurrency: parsed.data.declaredCurrency, customerNote: parsed.data.customerNote, warehouseAddress }, select: requestSelect });
      await tx.complianceScreeningAttempt.update({ where: { id: compliance.attempt.id }, data: { subjectReference: created.id } });
      await createTransactionalNotification(tx, { userId: session.userId, eventType: "SHIP_FOR_ME_ADDRESS_ISSUED", title: `Warehouse address ready · ${reference}`, titleBn: `গুদামের ঠিকানা প্রস্তুত · ${reference}`, body: "Use your unique reference on the seller's parcel, then submit inbound tracking from Ship for Me.", bodyBn: "বিক্রেতার পার্সেলে আপনার ইউনিক রেফারেন্স ব্যবহার করুন, এরপর Ship for Me থেকে ইনবাউন্ড ট্র্যাকিং জমা দিন।", deepLink: `/ship-for-me/${created.id}`, entityType: "ShipForMeRequest", entityId: created.id, idempotencyKey: `ship-for-me-address:${created.id}` });
      await tx.auditLog.create({ data: { actorId: session.userId, action: "ship_for_me.address_issued", entityType: "ShipForMeRequest", entityId: created.id, metadata: { orderId: order.id, originWarehouseId: warehouse.id, shippingLaneId: lane.id, sourceCountryCode: lane.originCountry.isoCode, destinationCountryCode: lane.destinationCountry.isoCode, policyVersion: "1.1" } } });
      return { request: created, replay: false };
    }, { isolationLevel: "Serializable" });
    if (!result) return apiError("SHIP_FOR_ME_UNAVAILABLE", "No approved source lane and origin warehouse address are available for this country.", 409);
    if ("compliance" in result && result.compliance) return apiError(result.compliance.outcome === "BLOCKED" ? "RESTRICTED_GOODS_BLOCKED" : "COMPLIANCE_REVIEW_REQUIRED", result.compliance.customerMessage ?? "This shipment request cannot continue until a compliance review is completed.", result.compliance.outcome === "BLOCKED" ? 422 : 409, { screeningReference: result.compliance.attempt.id });
    return apiSuccess({ request: result.request, idempotentReplay: result.replay, nextAction: result.request.status === "ADDRESS_ISSUED" ? "SHIP_TO_WAREHOUSE_AND_SUBMIT_TRACKING" : "VIEW_REQUEST" }, { status: result.replay ? 200 : 201, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    if ((error as { code?: string }).code === "P2034") return apiError("REQUEST_RETRY_REQUIRED", "Configuration changed while issuing the address. Please retry safely.", 409);
    throw error;
  }
}
