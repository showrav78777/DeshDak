import type { Prisma } from "@prisma/client";

export const publicWishlistProductWhere = {
  status: "ACTIVE",
  complianceStatus: "CLEAR",
  deletedAt: null,
  category: { is: { isActive: true } },
  OR: [{ sellerProfileId: null }, { sellerProfile: { status: "APPROVED" } }],
} satisfies Prisma.ProductWhereInput;

export const wishlistProductSelect = {
  id: true,
  productCode: true,
  titleEn: true,
  titleBn: true,
  shortDescription: true,
  originCountryCode: true,
  isInternationallyAvailable: true,
  category: { select: { slug: true, nameEn: true } },
  sellerProfile: { select: { businessName: true, storeSlug: true } },
  media: { where: { status: "READY" as const }, select: { id: true, kind: true, altText: true, isPrimary: true }, orderBy: [{ isPrimary: "desc" as const }, { sortOrder: "asc" as const }], take: 1 },
  variants: { select: { id: true, priceBdt: true, priceCurrency: true, inventoryQuantity: true, stockStatus: true }, orderBy: { createdAt: "asc" as const }, take: 1 },
} satisfies Prisma.ProductSelect;
