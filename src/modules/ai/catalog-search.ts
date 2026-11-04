import { prisma } from "@/lib/prisma";
import { normalizeMarketCountry, productMarketPriority } from "@/modules/catalog/market-policy";

const stopWords = new Set(["a", "an", "the", "find", "show", "me", "i", "want", "need", "please", "product", "products"]);

export async function searchApprovedCatalog(query: string, limit = 12, customerCountryCode = "BD") {
  const normalized = query.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ").trim();
  const tokens = normalized.split(" ").filter((token) => token.length > 1 && !stopWords.has(token)).slice(0, 8);
  if (!tokens.length) return [];
  const products = await prisma.product.findMany({
    where: {
      status: "ACTIVE",
      complianceStatus: "CLEAR",
      deletedAt: null,
      category: { is: { isActive: true } },
      OR: tokens.flatMap((token) => [
        { titleEn: { contains: token, mode: "insensitive" as const } },
        { titleBn: { contains: token, mode: "insensitive" as const } },
        { description: { contains: token, mode: "insensitive" as const } },
        { category: { is: { nameEn: { contains: token, mode: "insensitive" as const }, isActive: true } } },
        { category: { is: { nameBn: { contains: token, mode: "insensitive" as const }, isActive: true } } },
        { sellerProfile: { is: { businessName: { contains: token, mode: "insensitive" as const }, status: "APPROVED" as const } } },
      ]),
    },
    select: { id: true, titleEn: true, titleBn: true, description: true, originCountryCode: true, isInternationallyAvailable: true, minimumOrderQuantity: true, createdAt: true, category: { select: { id: true, slug: true, nameEn: true, nameBn: true } }, sellerProfile: { select: { businessName: true, storeSlug: true } }, media: { where: { status: "READY", kind: "IMAGE" }, select: { storageKey: true, altText: true }, take: 1 }, variants: { select: { id: true, priceBdt: true, priceCurrency: true, inventoryQuantity: true, stockStatus: true }, take: 1 } },
    take: Math.min(500, Math.max(50, limit * 2)),
  });
  const marketCountry = normalizeMarketCountry(customerCountryCode);
  return products.map((product) => {
    const titleEn = product.titleEn.toLowerCase();
    const titleBn = product.titleBn?.toLowerCase() ?? "";
    const categoryEn = product.category?.nameEn.toLowerCase() ?? "";
    const categoryBn = product.category?.nameBn?.toLowerCase() ?? "";
    const storeName = product.sellerProfile?.businessName.toLowerCase() ?? "";
    const haystack = `${titleEn} ${titleBn} ${categoryEn} ${categoryBn} ${storeName} ${product.description ?? ""}`.toLowerCase();
    const exactTitle = titleEn === normalized || titleBn === normalized;
    const startsWithQuery = titleEn.startsWith(normalized) || titleBn.startsWith(normalized);
    const score = (exactTitle ? 100 : 0) + (startsWithQuery ? 40 : 0) + tokens.reduce((total, token) => total + (titleEn === token ? 18 : 0) + (titleEn.includes(token) ? 8 : 0) + (titleBn.includes(token) ? 7 : 0) + (categoryEn.includes(token) || categoryBn.includes(token) ? 5 : 0) + (storeName.includes(token) ? 6 : 0) + (haystack.includes(token) ? 1 : 0), 0);
    return { ...product, score };
  }).sort((a, b) => b.score - a.score || productMarketPriority(a.originCountryCode, marketCountry) - productMarketPriority(b.originCountryCode, marketCountry) || a.titleEn.localeCompare(b.titleEn)).slice(0, limit).map((ranked) => ({ id: ranked.id, titleEn: ranked.titleEn, titleBn: ranked.titleBn, description: ranked.description, originCountryCode: ranked.originCountryCode, isInternationallyAvailable: ranked.isInternationallyAvailable, minimumOrderQuantity: ranked.minimumOrderQuantity, createdAt: ranked.createdAt, category: ranked.category, sellerProfile: ranked.sellerProfile, media: ranked.media, variants: ranked.variants }));
}
