import { type NextRequest } from "next/server";
import { z } from "zod";

import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { getLogisticsAccess } from "@/lib/warehouse-access";
import { normalizeLogisticsScan, resolveLogisticsScan } from "@/modules/logistics/scan";

const schema = z.object({ code: z.string().trim().min(1).max(500) });

async function lookup(request: NextRequest, rawCode: string, logScan: boolean) {
  const session = await getRequestSession(request); const access = await getLogisticsAccess(session);
  if (!session || !access) return apiError("LOGISTICS_ACCESS_REQUIRED", "Logistics portal access is required.", 403);
  const code = normalizeLogisticsScan(rawCode);
  if (!code) return apiError("INVALID_SCAN_CODE", "Scan a valid shipment, tracking, package, or order code.", 422);
  const resolved = await resolveLogisticsScan(code, access);
  if (!resolved) return apiError("SHIPMENT_TASK_NOT_FOUND", "No assigned shipment matches this code.", 404);
  if (logScan) await prisma.auditLog.create({ data: { actorId: session.userId, action: "logistics.shipment_scanned", entityType: "Shipment", entityId: resolved.shipment.id, metadata: { matchedBy: code === resolved.shipment.shipmentCode ? "shipment_code" : code === resolved.shipment.trackingNumber ? "tracking_number" : "package_or_order_code" } } });
  return apiSuccess({ destination: resolved.destination, shipment: { shipmentCode: resolved.shipment.shipmentCode, trackingNumber: resolved.shipment.trackingNumber, status: resolved.shipment.status, carrierName: resolved.shipment.carrierName, packageCodes: resolved.shipment.packages.map(({ package: pkg }) => pkg.packageCode) } }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function GET(request: NextRequest) { return lookup(request, request.nextUrl.searchParams.get("code") ?? "", false); }
export async function POST(request: NextRequest) { const parsed = schema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return apiError("VALIDATION_ERROR", "Provide the scanned code.", 422); return lookup(request, parsed.data.code, true); }
