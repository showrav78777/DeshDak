import Link from "next/link";
import { redirect } from "next/navigation";
import { AutomaticPromotionCreateForm, AutomaticPromotionStatusControl } from "@/components/automatic-promotion-management";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { getServerSession } from "@/lib/server-session";

export const dynamic = "force-dynamic";

function displayDate(value: Date) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dhaka" }).format(value);
}

export default async function AdminPromotionsPage() {
  const session = await getServerSession();
  if (!session?.roles.includes(ROLE.ADMIN)) redirect("/");
  const promotions = await prisma.automaticPromotion.findMany({ include: { _count: { select: { applications: true } } }, orderBy: [{ priority: "desc" }, { createdAt: "desc" }] });
  const activeCount = promotions.filter((promotion) => promotion.status === "ACTIVE").length;
  const draftCount = promotions.filter((promotion) => promotion.status === "DRAFT").length;
  const applicationCount = promotions.reduce((total, promotion) => total + promotion._count.applications, 0);

  return <section className="admin-content offer-admin-page">
    <header className="offer-page-head"><div><p className="eyebrow">AUTOMATIC SAVINGS</p><h1>Promotions</h1><p className="admin-intro">Apply the best eligible saving automatically—without asking customers for a code.</p></div><nav aria-label="Discount tools"><Link href="/admin/coupons">Coupons</Link><Link className="active" href="/admin/promotions">Automatic promotions</Link></nav></header>
    <aside className="offer-rule-note"><b>How selection works</b><span>Only one automatic promotion wins. Higher priority is considered first; coupon stacking works only when both rules allow it.</span></aside>
    <section className="offer-stats" aria-label="Promotion overview"><article><span>Active promotions</span><b>{activeCount}</b><small>currently evaluated</small></article><article><span>Drafts</span><b>{draftCount}</b><small>waiting for review</small></article><article><span>Total applications</span><b>{applicationCount}</b><small>successful savings</small></article></section>
    <details className="offer-builder"><summary><span><b>＋ Create a promotion</b><small>Set the customer message, saving rules, priority, and dates</small></span><i aria-hidden="true">⌄</i></summary><div className="offer-builder-body"><p>New promotions remain inactive until you review and activate them.</p><AutomaticPromotionCreateForm /></div></details>
    <section className="offer-register"><header><div><p className="eyebrow">PROMOTION REGISTER</p><h2>Existing promotions</h2></div><span>{promotions.length} total</span></header>{promotions.length ? <div className="coupon-admin-list">{promotions.map((promotion) => <article key={promotion.id}><header><div><b>{promotion.name}</b><span>{promotion.customerMessage}</span><small>{promotion.internalDescription ?? "No internal note"}</small></div><em className={promotion.status === "ACTIVE" ? "status-active" : "status-inactive"}>{promotion.status}</em></header><dl><div><dt>Customer saving</dt><dd>{promotion.discountType === "PERCENTAGE" ? `${promotion.discountValue.toString()}%` : `BDT ${promotion.discountValue.toString()}`}{promotion.maximumDiscount ? ` · maximum BDT ${promotion.maximumDiscount.toString()}` : ""}</dd></div><div><dt>Minimum order</dt><dd>BDT {promotion.minimumOrderAmount.toString()}</dd></div><div><dt>Usage</dt><dd>{promotion._count.applications}{promotion.totalUsageLimit ? ` of ${promotion.totalUsageLimit}` : " applied"} · {promotion.perCustomerLimit} per customer</dd></div><div><dt>Selection</dt><dd>Priority {promotion.priority} · {promotion.allowsCouponStacking ? "coupon stacking allowed" : "no stacking"}</dd></div><div><dt>Audience</dt><dd>{promotion.eligibleAccountType ?? "All customers"}{promotion.firstOrderOnly ? " · first order only" : ""}</dd></div><div><dt>Active window</dt><dd>{displayDate(promotion.startsAt)} → {displayDate(promotion.endsAt)}</dd></div></dl><AutomaticPromotionStatusControl promotionId={promotion.id} status={promotion.status} version={promotion.version} /></article>)}</div> : <div className="offer-empty"><span>✦</span><h3>No promotions yet</h3><p>Open “Create a promotion” above to prepare your first automatic saving.</p></div>}</section>
  </section>;
}
