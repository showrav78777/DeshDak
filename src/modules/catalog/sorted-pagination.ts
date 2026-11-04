import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// Explicit sorting applies before pagination; market ranking remains the
// separate Recommended choice. Price sorting uses the displayed lowest
// matching variant and always leaves unpriced products at the end.
export async function sortedProductPage(where: Prisma.ProductWhereInput, variantWhere: Prisma.ProductVariantWhereInput, sort: "price_asc" | "price_desc" | "name_asc", page: number, pageSize: number) {
  const skip = (page - 1) * pageSize;
  const total = await prisma.product.count({ where });
  if (sort === "name_asc") {
    const rows = await prisma.product.findMany({ where, select: { id: true }, orderBy: [{ titleEn: "asc" }, { id: "asc" }], skip, take: pageSize });
    return { ids: rows.map(({ id }) => id), total };
  }
  const pricedVariant: Prisma.ProductVariantWhereInput = { AND: [variantWhere, { priceBdt: { not: null } }] };
  const pricedTotal = await prisma.product.count({ where: { AND: [where, { variants: { some: pricedVariant } }] } });
  const priced = skip < pricedTotal ? await prisma.productVariant.groupBy({
    by: ["productId"], where: { AND: [pricedVariant, { product: where }] },
    _min: { priceBdt: true },
    orderBy: [{ _min: { priceBdt: sort === "price_asc" ? "asc" : "desc" } }, { productId: "asc" }],
    skip, take: pageSize,
  }) : [];
  const missing = priced.length < pageSize ? await prisma.product.findMany({
    where: { AND: [where, { variants: { none: pricedVariant } }] }, select: { id: true },
    orderBy: { id: "asc" }, skip: Math.max(0, skip - pricedTotal), take: pageSize - priced.length,
  }) : [];
  return { ids: [...priced.map(({ productId }) => productId), ...missing.map(({ id }) => id)], total };
}
