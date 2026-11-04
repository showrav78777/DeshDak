import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { StoreHeader } from "@/components/store-header";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "@/lib/server-session";
import "../help.css";

async function publishedArticle(slug: string) {
  return prisma.helpArticle.findFirst({ where: { slug, status: "PUBLISHED", category: { isActive: true } }, include: { category: { select: { slug: true, nameEn: true, nameBn: true } } } });
}

export async function generateMetadata({ params }: PageProps<"/help/[slug]">): Promise<Metadata> {
  const { slug } = await params; const article = await publishedArticle(slug);
  if (!article) return { title: "Help article not found", robots: { index: false, follow: false } };
  const canonical = `/help/${encodeURIComponent(article.slug)}`;
  return {
    title: `${article.titleEn} | Help Centre`,
    description: article.summaryEn,
    alternates: { canonical },
    openGraph: { title: article.titleEn, description: article.summaryEn, url: canonical, type: "article" },
  };
}

export default async function HelpArticlePage({ params, searchParams }: PageProps<"/help/[slug]"> & { searchParams: Promise<{ lang?: string }> }) {
  const [{ slug }, query, session] = await Promise.all([params, searchParams, getServerSession()]);
  const article = await publishedArticle(slug); if (!article) notFound();
  const language = query.lang === "bn" && article.bodyBn ? "bn" : "en";
  const title = language === "bn" && article.titleBn ? article.titleBn : article.titleEn;
  const summary = language === "bn" && article.summaryBn ? article.summaryBn : article.summaryEn;
  const body = language === "bn" && article.bodyBn ? article.bodyBn : article.bodyEn;
  const categoryName = language === "bn" && article.category.nameBn ? article.category.nameBn : article.category.nameEn;
  return <main className="help-centre"><StoreHeader session={session} /><article className="help-article-page"><nav><Link href={`/help?lang=${language}&category=${article.category.slug}`}>← {categoryName}</Link><span>Updated {article.updatedAt.toLocaleDateString()}</span></nav><header><p className="eyebrow">{categoryName}</p><h1>{title}</h1><p>{summary}</p>{article.bodyBn ? <div className="help-language"><Link className={language === "en" ? "active" : ""} href={`/help/${article.slug}?lang=en`}>English</Link><Link className={language === "bn" ? "active" : ""} href={`/help/${article.slug}?lang=bn`}>বাংলা</Link></div> : null}</header><section className="help-article-body">{body.split(/\n{2,}/).map((paragraph, index) => <p key={`${article.id}-${index}`}>{paragraph}</p>)}</section><footer><div><b>Still need help?</b><p>Account-specific questions and evidence belong in a protected support request.</p></div><Link className="button primary" href={session ? "/support" : `/login?next=${encodeURIComponent(`/support`)}`}>{session ? "Open support request" : "Sign in for support"}</Link></footer></article></main>;
}
