import { type NextRequest } from "next/server";
import { z } from "zod";

import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { getInspectorAccess } from "@/lib/warehouse-access";
import { normalizeInspectionScan, resolveInspectionScan } from "@/modules/warehouse/inspection-scan";

const schema = z.object({ code: z.string().trim().min(1).max(500) });

async function lookup(request: NextRequest, rawCode: string, logScan: boolean) {
  const session = await getRequestSession(request); const access = await getInspectorAccess(session);
  if (!session || !access) return apiError("INSPECTION_ACCESS_REQUIRED", "Inspector portal access is required.", 403);
  const code = normalizeInspectionScan(rawCode);
  if (!code) return apiError("INVALID_SCAN_CODE", "Scan a valid DeshDak package, order, or inbound tracking code.", 422);
  const resolved = await resolveInspectionScan(code, access);
  if (!resolved) return apiError("INSPECTION_TASK_NOT_FOUND", "No assigned inspection task matches this code.", 404);
  if (logScan) await prisma.$transaction([
    prisma.packageEvent.create({ data: { packageId: resolved.package.id, eventType: "SCANNED", status: resolved.package.status, actorId: session.userId, note: "Package code scanned in Inspector portal." } }),
    prisma.auditLog.create({ data: { actorId: session.userId, action: "inspection.package_scanned", entityType: "Package", entityId: resolved.package.id, metadata: { matchedBy: code === resolved.package.packageCode ? "package_code" : code === resolved.package.order.orderNumber ? "order_code" : "inbound_tracking" } } }),
  ]);
  return apiSuccess({ destination: resolved.destination, package: { packageCode: resolved.package.packageCode, orderNumber: resolved.package.order.orderNumber, status: resolved.package.status, qcStatus: resolved.package.qcStatus } }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function GET(request: NextRequest) { return lookup(request, request.nextUrl.searchParams.get("code") ?? "", false); }
export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Provide the scanned code.", 422);
  return lookup(request, parsed.data.code, true);
}
