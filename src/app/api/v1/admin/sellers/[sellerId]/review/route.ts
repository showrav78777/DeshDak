import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/request-session";
import { ROLE } from "@/lib/roles";

const schema = z.object({ decision: z.enum(["APPROVED", "REJECTED"]), reviewNote: z.string().trim().min(3).max(500) });

function fallbackStoreSlug(businessName: string, sellerId: string) {
  const base = businessName.normalize("NFKD").replace(/[^a-zA-Z0-9\s-]/g, "").trim().toLowerCase().replace(/[\s_-]+/g, "-").replace(/^-|-$/g, "").slice(0, 45) || "bangladesh-store";
  return `${base}-${sellerId.slice(0, 8)}`;
}

export async function PATCH(request: NextRequest, context: RouteContext<"/api/v1/admin/sellers/[sellerId]/review">) {
  const session = await getRequestSession(request);
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") return apiError("ADMIN_ACCESS_REQUIRED", "Admin access is required.", 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "A decision and review note are required.", 422);
  const { sellerId } = await context.params;
  const seller = await prisma.sellerProfile.findUnique({ where: { id: sellerId }, select: { id: true, userId: true, businessName: true, storeSlug: true, status: true } });
  if (!seller) return apiError("SELLER_NOT_FOUND", "Seller application not found.", 404);
  if (seller.status !== "PENDING_REVIEW") return apiError("SELLER_ALREADY_REVIEWED", "This seller application has already been reviewed.", 409);

  const updated = await prisma.$transaction(async (tx) => {
    const profile = await tx.sellerProfile.update({ where: { id: sellerId }, data: { status: parsed.data.decision, reviewNote: parsed.data.reviewNote, reviewedAt: new Date(), version: { increment: 1 }, ...(parsed.data.decision === "APPROVED" && !seller.storeSlug ? { storeSlug: fallbackStoreSlug(seller.businessName, seller.id) } : {}) }, select: { id: true, businessName: true, storeSlug: true, status: true, reviewNote: true, reviewedAt: true } });
    if (parsed.data.decision === "APPROVED") await tx.user.update({ where: { id: seller.userId }, data: { status: "ACTIVE" } });
    await tx.auditLog.create({ data: { actorId: session.userId, action: `seller.${parsed.data.decision.toLowerCase()}`, entityType: "SellerProfile", entityId: sellerId, metadata: { reviewNote: parsed.data.reviewNote } } });
    return profile;
  });
  return apiSuccess({ sellerProfile: updated });
}
