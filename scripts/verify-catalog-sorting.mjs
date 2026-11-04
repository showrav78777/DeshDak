import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const database = new URL(process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1', '::1'].includes(database.hostname) || !/^crossly_launch_verify_[a-f0-9]{16}$/.test(database.searchParams.get('schema') ?? '')) throw new Error('Run this fixture test through verify:launch:isolated only.');
const base = process.env.TEST_BASE_URL ?? 'http://localhost:3117';
const prisma = new PrismaClient();
const marker = `sort-${randomUUID()}`;
let category;
const ids = [];
function assert(value, message) { if (!value) throw new Error(message); }
async function prices(sort, page = 1) {
  const response = await fetch(`${base}/products?category=${marker}&minPrice=700000&maxPrice=700100&sort=${sort}&page=${page}`);
  assert(response.ok, `Catalogue returned ${response.status}`);
  const html = await response.text();
  return [...html.matchAll(/class="public-product-meta"><b>([^<]+)<\/b>/g)].map((match) => Number(match[1].replace(/[^0-9.]/g, '')));
}
try {
  category = await prisma.category.create({ data: { slug: marker, nameEn: marker, isActive: true } });
  for (let index = 1; index <= 28; index++) {
    const product = await prisma.product.create({ data: { titleEn: `${marker}-${String(index).padStart(2, '0')}`, categoryId: category.id, status: 'ACTIVE', complianceStatus: 'CLEAR', originCountryCode: 'CN', variants: { create: [
      { priceBdt: 900000, priceCurrency: 'BDT', inventoryQuantity: 2, stockStatus: 'IN_STOCK' },
      { priceBdt: 700000 + index, priceCurrency: 'BDT', inventoryQuantity: 2, stockStatus: 'IN_STOCK' },
    ] } }, select: { id: true } });
    ids.push(product.id);
  }
  const ascending = [...await prices('price_asc'), ...await prices('price_asc', 2)];
  const descending = [...await prices('price_desc'), ...await prices('price_desc', 2)];
  assert(ascending.length === 28 && descending.length === 28, 'Pagination lost or duplicated catalogue fixtures.');
  assert(ascending.every((price, index) => price === 700001 + index), 'Ascending pages or matching variant prices are incorrect.');
  assert(descending.every((price, index) => price === 700028 - index), 'Descending pages or matching variant prices are incorrect.');
  const named = [...await prices('name_asc'), ...await prices('name_asc', 2)];
  assert(named.every((price, index) => price === 700001 + index), 'Name sorting must precede pagination.');
  console.log('Catalogue sorting regression passed: 28 products, matching variants, ascending/descending/name pagination.');
} finally {
  if (ids.length) { await prisma.productVariant.deleteMany({ where: { productId: { in: ids } } }); await prisma.product.deleteMany({ where: { id: { in: ids } } }); }
  if (category) await prisma.category.delete({ where: { id: category.id } });
  await prisma.$disconnect();
}
