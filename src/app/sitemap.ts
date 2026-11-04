import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function siteOrigin() {
  return new URL(process.env.APP_BASE_URL?.trim() || "http://localhost:3000").origin;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = siteOrigin();
  const [products, categories, stores, helpArticles] = await Promise.all([
    prisma.product.findMany({ where: { status: "ACTIVE", complianceStatus: "CLEAR", deletedAt: null }, select: { id: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 40_000 }),
    prisma.category.findMany({ where: { isActive: true }, select: { slug: true, updatedAt: true }, orderBy: { sortOrder: "asc" }, take: 5_000 }),
    prisma.sellerProfile.findMany({ where: { status: "APPROVED", storeSlug: { not: null } }, select: { storeSlug: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 5_000 }),
    prisma.helpArticle.findMany({ where: { status: "PUBLISHED", category: { isActive: true } }, select: { slug: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 10_000 }),
  ]);

  const publicPages: MetadataRoute.Sitemap = [
    { url: origin, changeFrequency: "daily", priority: 1 },
    { url: `${origin}/products`, changeFrequency: "daily", priority: 0.9 },
    { url: `${origin}/stores`, changeFrequency: "daily", priority: 0.8 },
    { url: `${origin}/trust`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${origin}/help`, changeFrequency: "weekly", priority: 0.7 },
  ];

  return [
    ...publicPages,
    ...products.map((product) => ({ url: `${origin}/products/${encodeURIComponent(product.id)}`, lastModified: product.updatedAt, changeFrequency: "weekly" as const, priority: 0.7 })),
    ...categories.map((category) => ({ url: `${origin}/products?category=${encodeURIComponent(category.slug)}`, lastModified: category.updatedAt, changeFrequency: "weekly" as const, priority: 0.6 })),
    ...stores.flatMap((store) => store.storeSlug ? [{ url: `${origin}/stores/${encodeURIComponent(store.storeSlug)}`, lastModified: store.updatedAt, changeFrequency: "weekly" as const, priority: 0.7 }] : []),
    ...helpArticles.map((article) => ({ url: `${origin}/help/${encodeURIComponent(article.slug)}`, lastModified: article.updatedAt, changeFrequency: "monthly" as const, priority: 0.6 })),
  ];
}
