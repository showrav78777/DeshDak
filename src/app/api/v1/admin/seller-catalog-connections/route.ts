import { SellerCatalogConnectionStatus, type Prisma } from "@prisma/client";
import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";
import { sellerCatalogConnectionView } from "@/modules/catalog/seller-catalog-connection";

const querySchema = z.object({
  status: z.enum(SellerCatalogConnectionStatus).optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export async function GET(request: NextRequest) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") return apiError("ADMIN_ACCESS_REQUIRED", "Admin access is required.", 403);
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Use a valid status, cursor, and page size.", 422);
  const where: Prisma.SellerCatalogConnectionWhereInput = parsed.data.status ? { status: parsed.data.status } : {};
  const rows = await prisma.sellerCatalogConnection.findMany({
    where,
    include: { sellerProfile: { select: { businessName: true, user: { select: { fullName: true, email: true } } } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: parsed.data.limit + 1,
    ...(parsed.data.cursor ? { cursor: { id: parsed.data.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > parsed.data.limit;
  const page = hasMore ? rows.slice(0, parsed.data.limit) : rows;
  return apiSuccess({ connections: page.map((connection) => ({ ...sellerCatalogConnectionView(connection, true), seller: connection.sellerProfile })), nextCursor: hasMore ? page.at(-1)?.id ?? null : null, activationLocked: true }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
