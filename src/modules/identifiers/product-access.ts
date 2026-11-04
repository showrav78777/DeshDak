import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { type SessionPayload } from "@/lib/session";

export async function productIdentifierAccess(productCode: string, session: SessionPayload | null) {
  const product = await prisma.product.findUnique({
    where: { productCode },
    select: { id: true, status: true, complianceStatus: true, deletedAt: true, category: { select: { isActive: true } }, sellerProfile: { select: { userId: true, status: true } } },
  });
  if (!product || product.deletedAt) return null;

  const isPublic = product.status === "ACTIVE" && product.complianceStatus === "CLEAR" && product.category?.isActive === true && (!product.sellerProfile || product.sellerProfile.status === "APPROVED");
  const isAdmin = Boolean(session?.roles.includes(ROLE.ADMIN));
  const isOwningSeller = Boolean(session?.roles.includes(ROLE.SELLER) && product.sellerProfile?.userId === session.userId);
  return isPublic || isAdmin || isOwningSeller ? { productId: product.id, isPublic } : null;
}
