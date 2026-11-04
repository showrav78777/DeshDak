import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";

export async function GET(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.COMPLIANCE) || session.portal !== "compliance") return apiError("COMPLIANCE_ACCESS_REQUIRED", "Verified Compliance access is required.", 403);
  const screenings = await prisma.complianceScreeningAttempt.findMany({ where: { outcome: "REVIEW_REQUIRED" }, select: { id: true, subject: true, subjectReference: true, customerId: true, originCountryCode: true, destinationCountryCode: true, matchedRuleCodes: true, outcome: true, version: true, createdAt: true }, orderBy: { createdAt: "asc" }, take: 100 });
  const customerIds = [...new Set(screenings.filter((item) => item.customerId !== "SYSTEM").map((item) => item.customerId))];
  const productIds = [...new Set(screenings.filter((item) => item.subject === "PRODUCT_PUBLICATION" && item.subjectReference).map((item) => item.subjectReference!))];
  const [customers, products] = await Promise.all([
    customerIds.length ? prisma.user.findMany({ where: { id: { in: customerIds } }, select: { id: true, personCode: true, fullName: true } }) : [],
    productIds.length ? prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, productCode: true, titleEn: true } }) : [],
  ]);
  const customerMap = new Map(customers.map((item) => [item.id, item]));
  const productMap = new Map(products.map((item) => [item.id, item]));
  return apiSuccess({ screenings: screenings.map((item) => ({ ...item, customer: customerMap.get(item.customerId) ?? null, product: item.subjectReference ? productMap.get(item.subjectReference) ?? null : null })) }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
