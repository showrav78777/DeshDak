import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";

export async function GET(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN)) return apiError("ADMIN_ACCESS_REQUIRED", "Administrator access is required.", 403);
  const params = request.nextUrl.searchParams;
  const page = Math.max(1, Number(params.get("page")) || 1);
  const pageSize = Math.min(50, Math.max(10, Number(params.get("pageSize")) || 20));
  const query = params.get("q")?.trim().slice(0, 120) ?? "";
  const market = params.get("market");
  const where = {
    deletedAt: null,
    roles: { some: { role: { code: { in: [ROLE.CUSTOMER_PERSONAL, "customer_business"] } } } },
    ...(market === "bangladesh" ? { residenceCountryCode: "BD" } : market === "international" ? { residenceCountryCode: { not: "BD" } } : {}),
    ...(query ? { OR: [{ personCode: { contains: query, mode: "insensitive" as const } }, { fullName: { contains: query, mode: "insensitive" as const } }, { email: { contains: query, mode: "insensitive" as const } }, { phone: { contains: query, mode: "insensitive" as const } }] } : {}),
  };
  const [users, total] = await prisma.$transaction([
    prisma.user.findMany({ where, select: { id: true, personCode: true, fullName: true, email: true, phone: true, residenceCountryCode: true, status: true, accountType: true, kycStatus: true, analyticsConsent: true, createdAt: true, _count: { select: { orders: true, sourcingRequests: true, authSessions: true } }, orders: { select: { grandTotal: true }, where: { status: { not: "CANCELLED" } } } }, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.user.count({ where }),
  ]);
  return apiSuccess({ users: users.map(({ orders, ...user }) => ({ ...user, customerMarket: user.residenceCountryCode === "BD" ? "BANGLADESH" : "INTERNATIONAL", lifetimeOrderValue: orders.reduce((sum, order) => sum + Number(order.grandTotal), 0) })), pagination: { page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)) } }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
