import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { hasTrustedMutationOrigin } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { createReference } from "@/lib/reference";
import { getRequestSession } from "@/lib/request-session";
import { canAccessWarehouse, getWarehouseAccess } from "@/lib/warehouse-access";
import { createTransactionalNotification, orderNotification } from "@/modules/notifications/service";
import { matchesReceiptReplay, receiptRequestHash, warehouseReceiptSchema } from "@/modules/warehouse/receiving-policy";

export async function POST(request: NextRequest) {
  const session = await getRequestSession(request);
  const access = await getWarehouseAccess(session);
  if (!session || !access) return apiError("WAREHOUSE_ACCESS_REQUIRED", "Warehouse portal access is required.", 403);
  if (!hasTrustedMutationOrigin(request)) return apiError("UNTRUSTED_ORIGIN", "This receipt must originate from the protected Warehouse application.", 403);
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
  if (!idempotencyKey || !/^[A-Za-z0-9:._-]{16,255}$/.test(idempotencyKey)) return apiError("IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required.", 422);
  const parsed = warehouseReceiptSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Check the order and warehouse details.", 422);
  const requestHash = receiptRequestHash(session.userId, parsed.data);
  async function replayResult() {
    const replay = await prisma.package.findUnique({ where: { receiveIdempotencyKey: idempotencyKey }, select: { id: true, packageCode: true, status: true, warehouseId: true, inboundTracking: true } });
    if (!replay) return null;
    if (!replay.warehouseId || !canAccessWarehouse(access!, replay.warehouseId)) return apiError("PACKAGE_NOT_FOUND", "Package was not found.", 404);
    const event = await prisma.packageEvent.findFirst({ where: { packageId: replay.id, eventType: "RECEIVED" }, select: { actorId: true, metadata: true }, orderBy: { occurredAt: "asc" } });
    return matchesReceiptReplay(event, session!.userId, requestHash) ? apiSuccess({ package: replay, idempotentReplay: true }, { headers: { "Cache-Control": "private, no-store, max-age=0" } }) : apiError("IDEMPOTENCY_KEY_CONFLICT", "This request key does not match this receipt. Refresh and review the existing package before continuing.", 409);
  }
  const replay = await replayResult();
  if (replay) return replay;
  const [order, warehouse] = await Promise.all([
    prisma.order.findUnique({ where: { orderNumber: parsed.data.orderNumber }, select: { id: true, customerId: true, orderNumber: true, type: true, status: true, originCountryCode: true, _count: { select: { packages: { where: { supplierDispatch: { isNot: null } } } } }, shipForMeRequest: { select: { id: true, reference: true, status: true, originWarehouseId: true, expectedPackageCount: true } }, packages: { where: { status: "EXPECTED", isOutboundActive: true }, select: { id: true, packageCode: true, warehouseId: true, inboundTracking: true, status: true, supplierDispatch: { select: { id: true } } }, orderBy: { createdAt: "asc" } } } }),
    prisma.warehouse.findUnique({ where: { id: parsed.data.warehouseId }, select: { id: true, name: true, type: true, country: true } }),
  ]);
  if (!order || !warehouse) return apiError("ORDER_OR_WAREHOUSE_NOT_FOUND", "Order or warehouse was not found.", 404);
  if (!canAccessWarehouse(access, warehouse.id)) return apiError("ORDER_OR_WAREHOUSE_NOT_FOUND", "Order or warehouse was not found.", 404);
  const shipForMeReady = order.type === "SHIP_FOR_ME" && order.status === "DRAFT" && ["TRACKING_SUBMITTED", "PARTIALLY_RECEIVED"].includes(order.shipForMeRequest?.status ?? "");
  const supplierManifest = order.type === "BUY_AND_SHIP" && order._count.packages > 0;
  const usesExpectedParcels = shipForMeReady || supplierManifest;
  if (order.status !== "SUPPLIER_SHIPPED" && order.status !== "READY_FOR_COLLECTION" && !shipForMeReady) return apiError("ORDER_NOT_READY_FOR_RECEIVING", "Only expected Ship for Me, supplier-shipped, or seller-ready orders can be received at the origin warehouse.", 409);
  if (warehouse.type !== "ORIGIN") return apiError("ORIGIN_WAREHOUSE_REQUIRED", "Choose an origin warehouse for receiving.", 422);
  if (order.originCountryCode && warehouse.country !== order.originCountryCode) return apiError("WAREHOUSE_COUNTRY_MISMATCH", "Choose an origin warehouse in the order's origin country.", 422);
  if (shipForMeReady && order.shipForMeRequest?.originWarehouseId !== warehouse.id) return apiError("WAREHOUSE_ASSIGNMENT_MISMATCH", "This package is assigned to a different origin warehouse.", 404);
  const pkg = await prisma.$transaction(async (tx) => {
    // Serialize receipts against each other and against holds/cancellations.
    // A lock on the original stage fails if another receipt already advanced it.
    const locked = await tx.order.updateMany({ where: { id: order.id, status: order.status }, data: { updatedAt: new Date() } });
    if (locked.count !== 1) throw new Error("RECEIPT_CONFLICT");
    const expected = usesExpectedParcels ? (parsed.data.packageCode ? order.packages.find(item => item.packageCode === parsed.data.packageCode) : parsed.data.inboundTracking ? order.packages.find((item) => item.inboundTracking?.toLowerCase() === parsed.data.inboundTracking?.toLowerCase()) : order.packages.length === 1 ? order.packages[0] : null) : null;
    if (!usesExpectedParcels && parsed.data.packageCode) throw new Error("EXPECTED_PACKAGE_REQUIRED");
    if (usesExpectedParcels && !expected) throw new Error("EXPECTED_PACKAGE_REQUIRED");
    if (supplierManifest && !expected?.supplierDispatch) throw new Error("EXPECTED_PACKAGE_REQUIRED");
    if (expected && expected.warehouseId !== warehouse.id) throw new Error("EXPECTED_PACKAGE_WAREHOUSE_MISMATCH");
    if (expected && parsed.data.inboundTracking && expected.inboundTracking?.toLowerCase() !== parsed.data.inboundTracking.toLowerCase()) throw new Error("INBOUND_TRACKING_MISMATCH");
    let created;
    if (expected) {
      const received = await tx.package.updateMany({ where: { id: expected.id, status: "EXPECTED", warehouseId: warehouse.id }, data: { status: "RECEIVED", receiveIdempotencyKey: idempotencyKey } });
      if (received.count !== 1) throw new Error("EXPECTED_PACKAGE_REQUIRED");
      created = await tx.package.findUniqueOrThrow({ where: { id: expected.id } });
    } else {
      created = await tx.package.create({ data: { orderId: order.id, warehouseId: warehouse.id, packageCode: createReference("PKG"), inboundTracking: parsed.data.inboundTracking || null, receiveIdempotencyKey: idempotencyKey, status: "RECEIVED" } });
    }
    await tx.packageEvent.create({ data: { packageId: created.id, eventType: "RECEIVED", status: "RECEIVED", actorId: session.userId, note: `Received at ${warehouse.name}.`, metadata: { warehouseId: warehouse.id, receiveRequestHash: requestHash } } });
    const remainingExpected = usesExpectedParcels ? await tx.package.count({ where: { orderId: order.id, status: "EXPECTED", isOutboundActive: true } }) : 0;
    const allExpectedReceived = !usesExpectedParcels || remainingExpected === 0;
    if (allExpectedReceived) await tx.order.update({ where: { id: order.id }, data: { status: "WAREHOUSE_RECEIVED" } });
    if (order.shipForMeRequest) await tx.shipForMeRequest.update({ where: { id: order.shipForMeRequest.id }, data: { status: allExpectedReceived ? "WAREHOUSE_RECEIVED" : "PARTIALLY_RECEIVED", warehouseReceivedAt: allExpectedReceived ? new Date() : null } });
    if (order.type === "LOCAL_SELLER" || order.type === "EXPORT_MARKETPLACE") {
      const sellerOrders = await tx.sellerOrder.findMany({ where: { orderId: order.id, status: "READY_FOR_COLLECTION" }, select: { id: true } });
      for (const sellerOrder of sellerOrders) await tx.sellerOrder.update({ where: { id: sellerOrder.id }, data: { status: "RECEIVED_AT_ORIGIN_HUB", statusHistory: { create: { fromStatus: "READY_FOR_COLLECTION", toStatus: "RECEIVED_AT_ORIGIN_HUB", actorId: session.userId, note: `Products received at ${warehouse.name}.` } } } });
    }
    const note = `Package ${created.packageCode} received at ${warehouse.name}.`;
    if (allExpectedReceived) {
      const history = await tx.orderStatusHistory.create({ data: { orderId: order.id, fromStatus: order.status, toStatus: "WAREHOUSE_RECEIVED", actorId: session.userId, note } });
      const notification = orderNotification({ userId: order.customerId, orderId: order.id, orderNumber: order.orderNumber, status: "WAREHOUSE_RECEIVED", eventId: history.id });
      if (notification) await createTransactionalNotification(tx, notification);
    } else if (order.shipForMeRequest) {
      const receivedCount = order.shipForMeRequest.expectedPackageCount - remainingExpected;
      await createTransactionalNotification(tx, { userId: order.customerId, eventType: "SHIP_FOR_ME_PACKAGE_RECEIVED", title: `Parcel ${receivedCount} of ${order.shipForMeRequest.expectedPackageCount} received`, body: `${created.packageCode} was physically received at ${warehouse.name}. We are waiting for ${remainingExpected} more parcel${remainingExpected === 1 ? "" : "s"}.`, deepLink: `/ship-for-me/${order.shipForMeRequest.id}`, entityType: "ShipForMeRequest", entityId: order.shipForMeRequest.id, idempotencyKey: `ship-for-me-package-received:${created.id}` });
    }
    await tx.auditLog.create({ data: { actorId: session.userId, action: "warehouse.package_received", entityType: "Package", entityId: created.id, metadata: { orderNumber: parsed.data.orderNumber, warehouseId: warehouse.id, workflow: order.type, shipForMeReference: order.shipForMeRequest?.reference ?? null, remainingExpected } } });
    return created;
  }, { isolationLevel: "Serializable" }).catch((error) => {
    const code = (error as Error).message;
    if (["EXPECTED_PACKAGE_REQUIRED", "EXPECTED_PACKAGE_WAREHOUSE_MISMATCH", "INBOUND_TRACKING_MISMATCH", "RECEIPT_CONFLICT"].includes(code) || ["P2002", "P2034"].includes((error as { code?: string }).code ?? "")) return null;
    throw error;
  });
  if (!pkg) return await replayResult() ?? apiError("RECEIPT_CONFLICT", "The order or parcel changed during receiving. Refresh and review existing packages before retrying.", 409);
  return apiSuccess({ package: pkg, idempotentReplay: false }, { status: 201, headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
