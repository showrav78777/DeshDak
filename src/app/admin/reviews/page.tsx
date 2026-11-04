import Link from "next/link";
/* eslint-disable react/no-unescaped-entities */
import { redirect } from "next/navigation";
import { CustomerAdminHeader } from "@/components/customer-admin-header";
import { ProductReviewModeration } from "@/components/product-review-moderation";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { getServerSession } from "@/lib/server-session";

export const dynamic = "force-dynamic";

export default async function AdminProductReviewsPage() {
  const session = await getServerSession();
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") redirect("/admin/login");
  const reviews = await prisma.productReview.findMany({ where: { status: "PENDING_MODERATION" }, select: { id: true, rating: true, title: true, body: true, verifiedPurchase: true, version: true, createdAt: true, product: { select: { id: true, productCode: true, titleEn: true } }, customer: { select: { personCode: true, fullName: true } }, orderItem: { select: { order: { select: { orderNumber: true, status: true } } } } }, orderBy: { createdAt: "asc" }, take: 100 });
  return <main className="dashboard-shell"><CustomerAdminHeader name={session.fullName} /><section className="admin-content"><p className="eyebrow">REVIEW MODERATION</p><h1>Publish only verified, appropriate product feedback.</h1><p className="admin-intro">Every submission is tied to one delivered order item. Publishing never exposes the customer's email, phone, address, person ID, or order number.</p>{reviews.length ? <div className="review-moderation-list">{reviews.map((review) => <article className="dashboard-card" key={review.id}><div><p className="eyebrow">{review.product.productCode} · {"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}</p><h2>{review.title ?? review.product.titleEn}</h2><p>{review.body}</p><small>Verified purchase · {review.customer.fullName} ({review.customer.personCode}) · {review.orderItem.order.orderNumber} · {review.createdAt.toLocaleString()}</small><p><Link href={`/products/${review.product.id}`}>Open public product</Link></p></div><ProductReviewModeration reviewId={review.id} version={review.version} /></article>)}</div> : <div className="dashboard-card"><h2>No reviews awaiting moderation</h2><p>New verified-purchase reviews will appear here.</p></div>}</section></main>;
}
