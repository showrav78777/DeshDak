import Link from "next/link";
import { redirect } from "next/navigation";

import { AdminLogoutButton } from "@/components/admin-logout-button";
import { HelpArticleCreateForm, HelpArticleSettingsForm, HelpCategoryCreateForm, HelpCategorySettingsForm } from "@/components/help-centre-management";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { getServerSession } from "@/lib/server-session";
import "./help-admin.css";

export const dynamic = "force-dynamic";

export default async function AdminHelpPage() {
  const session = await getServerSession();
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") redirect("/admin/login");
  const [categories, articles] = await Promise.all([
    prisma.helpCategory.findMany({ include: { _count: { select: { articles: true } } }, orderBy: [{ sortOrder: "asc" }, { nameEn: "asc" }] }),
    prisma.helpArticle.findMany({ include: { category: { select: { slug: true, nameEn: true, isActive: true } }, updatedBy: { select: { fullName: true } } }, orderBy: [{ updatedAt: "desc" }], take: 500 }),
  ]);
  const published = articles.filter((article) => article.status === "PUBLISHED").length;
  const drafts = articles.filter((article) => article.status === "DRAFT").length;
  return <main className="dashboard-shell"><nav className="site-nav"><Link className="brand" href="/admin"><span className="brand-mark">D</span><span>DeshDak Admin</span></Link><div className="customer-nav-account"><Link href="/help">Public preview</Link><span className="dashboard-user">{session.fullName}</span><AdminLogoutButton /></div></nav><section className="admin-content help-admin-page"><p className="eyebrow">HELP CENTRE CONTENT</p><h1>Publish guidance without changing code.</h1><p className="admin-intro">Create bilingual categories and plain-text articles, review drafts, and publish only approved customer guidance. URL slugs remain stable and every change is audited.</p><div className="help-admin-stats"><article><b>{categories.length}</b><span>Categories</span></article><article><b>{articles.length}</b><span>Articles</span></article><article><b>{drafts}</b><span>Drafts</span></article><article><b>{published}</b><span>Published</span></article></div><section className="help-admin-create-grid"><article><h2>Add category</h2><HelpCategoryCreateForm /></article><article><h2>Create article draft</h2><HelpArticleCreateForm categories={categories} /></article></section><section className="help-admin-section"><div className="help-admin-heading"><div><p className="eyebrow">CATEGORY CONTROL</p><h2>Visibility and order</h2></div><span>{categories.filter((category) => category.isActive).length} public</span></div><div className="help-category-admin-list">{categories.map((category) => <details key={category.id}><summary><span><b>{category.nameEn}</b><small>/{category.slug} · {category._count.articles} article(s)</small></span><em className={category.isActive ? "status-active" : "status-inactive"}>{category.isActive ? "Public" : "Private"}</em></summary><HelpCategorySettingsForm category={category} /></details>)}</div></section><section className="help-admin-section"><div className="help-admin-heading"><div><p className="eyebrow">ARTICLE CONTROL</p><h2>Draft, publish, or archive</h2></div><span>{articles.length} total</span></div><div className="help-article-admin-list">{articles.map((article) => <details key={article.id}><summary><span><b>{article.titleEn}</b><small>/{article.slug} · {article.category.nameEn} · updated by {article.updatedBy.fullName}</small></span><em className={`help-status-${article.status.toLowerCase()}`}>{article.status}</em></summary><HelpArticleSettingsForm article={article} categories={categories} /></details>)}</div></section></section></main>;
}
