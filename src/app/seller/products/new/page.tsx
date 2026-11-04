import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SellerProductForm } from "@/components/seller-product-form";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function NewSellerProductPage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;
  if (!session?.roles.includes(ROLE.SELLER) || session.portal !== "seller") redirect("/seller/login");
  const [seller, categories] = await Promise.all([prisma.sellerProfile.findUnique({ where: { userId: session.userId }, select: { status: true } }), prisma.category.findMany({ where: { isActive: true }, select: { id: true, nameEn: true }, orderBy: [{ sortOrder: "asc" }, { nameEn: "asc" }] })]);
  if (!seller || seller.status !== "APPROVED") redirect("/seller/products");
  return <main className="dashboard-shell"><nav className="site-nav"><Link className="brand" href="/seller/products"><span className="brand-mark">D</span><span>DeshDak Seller</span></Link><span className="dashboard-user">{session.fullName}</span></nav><section className="seller-product-editor"><Link className="back-link seller-back-link" href="/seller/products">← Back to catalog</Link><p className="eyebrow">NEW PRODUCT</p><h1>Add a product</h1><p className="seller-catalog-principle">Your product stays private until Admin verifies its public content, category, and export information.</p><div className="product-form-card"><SellerProductForm categories={categories} /></div></section></main>;
}
