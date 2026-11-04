import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeMarketCountry } from "@/modules/catalog/market-policy";

export async function marketOrderedProductPage(where: Prisma.ProductWhereInput, customerCountryCode: string, page: number, pageSize: number) {
  const country = normalizeMarketCountry(customerCountryCode);
  const preferredCountry: Prisma.ProductWhereInput = country === "BD"
    ? { originCountryCode: { not: "BD" } }
    : { originCountryCode: country };
  const remainingCountries: Prisma.ProductWhereInput = country === "BD"
    ? { originCountryCode: "BD" }
    : { originCountryCode: { not: country } };
  const preferredWhere: Prisma.ProductWhereInput = { AND: [where, preferredCountry] };
  const remainingWhere: Prisma.ProductWhereInput = { AND: [where, remainingCountries] };
  const [total, preferredTotal] = await prisma.$transaction([
    prisma.product.count({ where }),
    prisma.product.count({ where: preferredWhere }),
  ]);
  const skip = (page - 1) * pageSize;
  const preferredSkip = Math.min(skip, preferredTotal);
  const preferredTake = Math.min(pageSize, Math.max(0, preferredTotal - skip));
  const preferred = preferredTake > 0 ? await prisma.product.findMany({ where: preferredWhere, select: { id: true }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: preferredSkip, take: preferredTake }) : [];
  const remainingTake = pageSize - preferred.length;
  const remainingSkip = Math.max(0, skip - preferredTotal);
  const remaining = remainingTake > 0 ? await prisma.product.findMany({ where: remainingWhere, select: { id: true }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: remainingSkip, take: remainingTake }) : [];
  return { ids: [...preferred, ...remaining].map(({ id }) => id), total, country };
}
