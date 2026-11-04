import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { SellerReviewActions } from "@/components/seller-review-actions";
import { StoreRevisionReviewActions } from "@/components/store-revision-review-actions";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AdminSellersPage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") redirect("/");
  const [sellers, revisions] = await Promise.all([
    prisma.sellerProfile.findMany({ where: { status: "PENDING_REVIEW" }, include: { user: { select: { fullName: true, email: true, phone: true } } }, orderBy: { createdAt: "asc" } }),
    prisma.sellerStoreRevision.findMany({ where: { status: "PENDING_REVIEW" }, include: { sellerProfile: { select: { businessName: true, storeCode: true, storeSlug: true, storeDescription: true, processingDays: true, version: true, user: { select: { email: true } } } } }, orderBy: { submittedAt: "asc" } }),
  ]);
  return <main className="dashboard-shell"><nav className="site-nav"><Link className="brand" href="/admin"><span className="brand-mark">D</span><span>DeshDak Admin</span></Link><span className="dashboard-user">{session.fullName}</span></nav><section className="admin-content"><p className="eyebrow">SELLER MODERATION</p><h1>Review sellers and storefront changes.</h1><p className="admin-intro">New sellers remain inactive until approval. Approved public store details remain unchanged while a later seller proposal is reviewed.</p>
    <section className="moderation-section"><h2>Store changes ({revisions.length})</h2>{revisions.length ? <div className="seller-review-list">{revisions.map((revision) => <article className="seller-review-card revision-review-card" key={revision.id}><div><p className="eyebrow">STORE CHANGE · {revision.sellerProfile.businessName}</p><h2>{revision.businessName}</h2><p>{revision.storeDescription}</p><div className="revision-safety-note"><b>Current public name: {revision.sellerProfile.businessName}</b><br />Current description: {revision.sellerProfile.storeDescription ?? "Not supplied"}<br />Current preparation: {revision.sellerProfile.processingDays} day(s) · current version {revision.sellerProfile.version} · based on version {revision.baseSellerVersion}</div><dl><div><dt>Permanent URL</dt><dd>/stores/{revision.sellerProfile.storeSlug}</dd></div><div><dt>Proposed preparation</dt><dd>{revision.processingDays} day(s)</dd></div><div><dt>Seller contact</dt><dd>{revision.sellerProfile.user.email}</dd></div><div><dt>Submitted</dt><dd>{revision.submittedAt.toISOString()}</dd></div></dl></div><StoreRevisionReviewActions revisionId={revision.id} version={revision.version} /></article>)}</div> : <div className="dashboard-card"><h2>No store changes pending</h2><p>Approved sellers’ public profile proposals will appear here.</p></div>}</section>
    <section className="moderation-section"><h2>New seller applications ({sellers.length})</h2>{sellers.length ? <div className="seller-review-list">{sellers.map((seller) => <article className="seller-review-card" key={seller.id}><div><p className="eyebrow">PENDING REVIEW · BANGLADESH EXPORT SELLER</p><h2>{seller.businessName}</h2><p>{seller.storeDescription ?? "No public store description supplied."}</p><dl><div><dt>Applicant</dt><dd>{seller.user.fullName}</dd></div><div><dt>Store address</dt><dd>{seller.storeSlug ? `/stores/${seller.storeSlug}` : "Not provided"}</dd></div><div><dt>Email</dt><dd>{seller.user.email}</dd></div><div><dt>Phone</dt><dd>{seller.user.phone ?? "Not provided"}</dd></div><div><dt>Address</dt><dd>{seller.businessAddress ?? "Not provided"}</dd></div><div><dt>Preparation</dt><dd>{seller.processingDays} day(s)</dd></div><div><dt>Licence</dt><dd>{seller.tradeLicenseNo ?? "Not provided"}</dd></div><div><dt>NID / TIN</dt><dd>{seller.nidOrTin ?? "Not provided"}</dd></div></dl></div><SellerReviewActions sellerId={seller.id} /></article>)}</div> : <div className="dashboard-card"><h2>No pending applications</h2><p>New Bangladesh seller applications will appear here.</p></div>}</section>
  </section></main>;
}
