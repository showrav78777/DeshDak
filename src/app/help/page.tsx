import type { Metadata } from "next";
import { Prisma } from "@prisma/client";
import Link from "next/link";

import { StoreHeader } from "@/components/store-header";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "@/lib/server-session";
import "./help.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Help Centre",
  description: "Search approved DeshDak guidance for ordering, payments, sourcing, shipping, tracking, returns, and account support.",
  alternates: { canonical: "/help" },
  openGraph: {
    title: "DeshDak Help Centre",
    description: "Search approved DeshDak guidance for ordering, payments, sourcing, shipping, tracking, returns, and account support.",
    url: "/help",
  },
};

export default async function HelpCentrePage({ searchParams }: { searchParams: Promise<{ q?: string; category?: string; lang?: string }> }) {
  const [session, query] = await Promise.all([getServerSession(), searchParams]);
  const q = query.q?.trim().slice(0, 100) ?? "";
  const categorySlug = query.category?.trim().slice(0, 100) ?? "";
  const language = query.lang === "bn" ? "bn" : "en";
  const where: Prisma.HelpArticleWhereInput = { status: "PUBLISHED", category: { isActive: true, ...(categorySlug ? { slug: categorySlug } : {}) }, ...(q ? { OR: [{ titleEn: { contains: q, mode: "insensitive" } }, { titleBn: { contains: q, mode: "insensitive" } }, { summaryEn: { contains: q, mode: "insensitive" } }, { summaryBn: { contains: q, mode: "insensitive" } }, { bodyEn: { contains: q, mode: "insensitive" } }, { bodyBn: { contains: q, mode: "insensitive" } }, { keywords: { has: q.toLowerCase() } }] } : {}) };
  const [categories, articles] = await Promise.all([
    prisma.helpCategory.findMany({ where: { isActive: true }, include: { _count: { select: { articles: { where: { status: "PUBLISHED" } } } } }, orderBy: [{ sortOrder: "asc" }, { nameEn: "asc" }] }),
    prisma.helpArticle.findMany({ where, include: { category: { select: { slug: true, nameEn: true, nameBn: true } } }, orderBy: [{ isFeatured: "desc" }, { sortOrder: "asc" }, { publishedAt: "desc" }], take: 100 }),
  ]);
  return <main className="help-centre"><StoreHeader session={session} /><section className="help-hero"><p className="eyebrow">CROSSLY HELP CENTRE</p><h1>Find the answer before opening a request.</h1><p>Search approved guidance for shopping, sourcing, payments, warehouse handling, tracking, returns, and account security.</p><form className="help-search" method="get"><label htmlFor="help-query">Search Help Centre</label><div><input id="help-query" name="q" defaultValue={q} maxLength={100} placeholder={language === "bn" ? "আপনার প্রশ্ন লিখুন" : "Try: track my order"} /><input name="lang" type="hidden" value={language} />{categorySlug ? <input name="category" type="hidden" value={categorySlug} /> : null}<button type="submit">Search</button></div></form><div className="help-language"><Link className={language === "en" ? "active" : ""} href={`/help?lang=en${q ? `&q=${encodeURIComponent(q)}` : ""}${categorySlug ? `&category=${encodeURIComponent(categorySlug)}` : ""}`}>English</Link><Link className={language === "bn" ? "active" : ""} href={`/help?lang=bn${q ? `&q=${encodeURIComponent(q)}` : ""}${categorySlug ? `&category=${encodeURIComponent(categorySlug)}` : ""}`}>বাংলা</Link></div></section><section className="help-content"><nav className="help-categories" aria-label="Help categories"><Link className={!categorySlug ? "active" : ""} href={`/help?lang=${language}${q ? `&q=${encodeURIComponent(q)}` : ""}`}>All topics</Link>{categories.map((category) => <Link className={category.slug === categorySlug ? "active" : ""} href={`/help?lang=${language}&category=${encodeURIComponent(category.slug)}${q ? `&q=${encodeURIComponent(q)}` : ""}`} key={category.id}><span>{language === "bn" && category.nameBn ? category.nameBn : category.nameEn}</span><small>{category._count.articles}</small></Link>)}</nav><section className="help-results"><div className="help-results-head"><div><p className="eyebrow">APPROVED GUIDANCE</p><h2>{q ? `Results for “${q}”` : categorySlug ? "Articles in this topic" : "Browse all articles"}</h2></div><span>{articles.length} result{articles.length === 1 ? "" : "s"}</span></div>{articles.length ? <div className="help-article-list">{articles.map((article) => { const title = language === "bn" && article.titleBn ? article.titleBn : article.titleEn; const summary = language === "bn" && article.summaryBn ? article.summaryBn : article.summaryEn; const categoryName = language === "bn" && article.category.nameBn ? article.category.nameBn : article.category.nameEn; return <Link href={`/help/${article.slug}?lang=${language}`} key={article.id}><span>{categoryName}{article.isFeatured ? " · Featured" : ""}</span><h3>{title}</h3><p>{summary}</p><b>Read guidance →</b></Link>; })}</div> : <div className="help-empty"><span>⌕</span><h3>No published guidance matched.</h3><p>Try fewer words or another topic. If your issue is account-specific, sign in and open a protected support request.</p><Link className="button primary" href={session ? "/support" : "/login?next=/support"}>{session ? "Open support" : "Sign in for support"}</Link></div>}</section></section></main>;
}
