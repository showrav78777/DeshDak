import { type NextRequest } from "next/server";

import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";

export async function GET(request: NextRequest, context: RouteContext<"/api/v1/ship-for-me/requests/[requestId]">) {
  const session = await getRequestSession(request);
  if (!session) return apiError("AUTHENTICATION_REQUIRED", "Please sign in to view this request.", 401);
  if (!session.roles.includes(ROLE.CUSTOMER_PERSONAL)) return apiError("CUSTOMER_ACCESS_REQUIRED", "A customer account is required.", 403);
  const { requestId } = await context.params;
  const shipForMeRequest = await prisma.shipForMeRequest.findFirst({
    where: { id: requestId, customerId: session.userId },
    select: { id: true, reference: true, status: true, itemDescription: true, expectedPackageCount: true, declaredValue: true, declaredCurrency: true, customerNote: true, warehouseAddress: true, inboundCarrier: true, inboundTracking: true, policyVersion: true, trackingSubmittedAt: true, warehouseReceivedAt: true, createdAt: true, order: { select: { id: true, orderNumber: true, status: true, statusHistory: { select: { id: true, toStatus: true, note: true, createdAt: true }, orderBy: { createdAt: "asc" } }, packages: { select: { id: true, packageCode: true, status: true, inboundCarrier: true, inboundTracking: true, actualWeightGrams: true, volumetricWeightGrams: true, chargeableWeightGrams: true, qcStatus: true } }, packageExceptions: { select: { id: true, reference: true, type: true, status: true, customerNote: true, createdAt: true, resolvedAt: true }, orderBy: { createdAt: "desc" } }, shippingQuotes: { select: { id: true, version: true, totalBdt: true, status: true, expiresAt: true }, orderBy: { version: "desc" }, take: 1 } } }, shippingLane: { select: { name: true, transitDaysMin: true, transitDaysMax: true, originCountry: { select: { isoCode: true, name: true } }, destinationCountry: { select: { isoCode: true, name: true } } } } },
  });
  if (!shipForMeRequest) return apiError("SHIP_FOR_ME_REQUEST_NOT_FOUND", "Ship for Me request was not found.", 404);
  return apiSuccess({ request: shipForMeRequest }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
