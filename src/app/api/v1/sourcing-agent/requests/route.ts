import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";

export async function GET(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.SOURCING_AGENT) || session.portal !== "sourcing") return apiError("SOURCING_ACCESS_REQUIRED", "Sourcing Agent access is required.", 403);
  const requests = await prisma.sourcingRequest.findMany({ where: { status: { in: ["SUBMITTED", "UNDER_REVIEW"] } }, select: { id: true, reference: true, sourceCountryCode: true, productUrl: true, productTitle: true, selectedVariant: true, quantity: true, sourcePrice: true, sourceCurrency: true, customerNote: true, status: true, createdAt: true, customer: { select: { personCode: true, fullName: true } }, quotes: { where: { status: "DRAFT" }, select: { id: true, version: true, totalBdt: true, expiresAt: true }, take: 1, orderBy: { version: "desc" } } }, orderBy: { createdAt: "asc" }, take: 100 });
  return apiSuccess({ requests }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
