import { type NextRequest } from "next/server";
import { z } from "zod";

import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { getWarehouseAccess } from "@/lib/warehouse-access";
import { normalizeWarehouseScan, resolveWarehouseScan } from "@/modules/warehouse/scan";

const postSchema = z.object({ code: z.string().trim().min(1).max(500) });

async function lookup(request: NextRequest, rawCode: string, logScan: boolean) {
  const session = await getRequestSession(request);
  const access = await getWarehouseAccess(session);
  if (!session || !access) return apiError("WAREHOUSE_ACCESS_REQUIRED", "Warehouse portal access is required.", 403);
  const code = normalizeWarehouseScan(rawCode);
  if (!code) return apiError("INVALID_SCAN_CODE", "Scan a valid DeshDak QR, barcode, order code, package code, or inbound tracking number.", 422);
  const resolved = await resolveWarehouseScan(code, access);
  if (!resolved) return apiError("PACKAGE_OR_ORDER_NOT_FOUND", "No assigned warehouse task matches this code.", 404);
  if (logScan) {
    if (resolved.kind === "package") await prisma.$transaction([
      prisma.packageEvent.create({ data: { packageId: resolved.package.id, eventType: "SCANNED", status: resolved.package.status, actorId: session.userId, note: "Package code scanned in Warehouse Worker portal." } }),
      prisma.auditLog.create({ data: { actorId: session.userId, action: "warehouse.package_scanned", entityType: "Package", entityId: resolved.package.id, metadata: { matchedBy: code === resolved.package.packageCode ? "package_code" : code === resolved.package.order.orderNumber ? "order_code" : "inbound_tracking" } } }),
    ]);
    else await prisma.auditLog.create({ data: { actorId: session.userId, action: "warehouse.inbound_order_scanned", entityType: "Order", entityId: resolved.order.id, metadata: { orderNumber: resolved.order.orderNumber } } });
  }
  const data = resolved.kind === "package"
    ? { kind: resolved.kind, destination: resolved.destination, package: { packageCode: resolved.package.packageCode, orderNumber: resolved.package.order.orderNumber, status: resolved.package.status } }
    : { kind: resolved.kind, destination: resolved.destination, order: { orderNumber: resolved.order.orderNumber, status: resolved.order.status, productTitle: resolved.order.sourcingRequest?.productTitle ?? resolved.order.items[0]?.productTitle ?? "Inbound order" }, warehouses: resolved.matchingWarehouses };
  return apiSuccess(data, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function GET(request: NextRequest) {
  return lookup(request, request.nextUrl.searchParams.get("code") ?? "", false);
}

export async function POST(request: NextRequest) {
  const parsed = postSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Provide the scanned code.", 422);
  return lookup(request, parsed.data.code, true);
}
