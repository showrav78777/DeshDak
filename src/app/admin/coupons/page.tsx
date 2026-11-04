import Link from "next/link";
import { redirect } from "next/navigation";
import { CouponCreateForm, CouponStatusControl } from "@/components/coupon-management";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { getServerSession } from "@/lib/server-session";

export const dynamic = "force-dynamic";

function displayDate(value: Date) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dhaka" }).format(value);
}

export default async function AdminCouponsPage() {
  const session = await getServerSession();
  if (!session?.roles.includes(ROLE.ADMIN)) redirect("/");
  const coupons = await prisma.coupon.findMany({ include: { _count: { select: { redemptions: true } } }, orderBy: { createdAt: "desc" } });
  const activeCount = coupons.filter((coupon) => coupon.status === "ACTIVE").length;
  const draftCount = coupons.filter((coupon) => coupon.status === "DRAFT").length;
  const redemptionCount = coupons.reduce((total, coupon) => total + coupon._count.redemptions, 0);

  return <section className="admin-content offer-admin-page">
    <header className="offer-page-head"><div><p className="eyebrow">DISCOUNTS</p><h1>Coupons</h1><p className="admin-intro">Create checkout codes, review their limits, and activate them when ready.</p></div><nav aria-label="Discount tools"><Link className="active" href="/admin/coupons">Coupons</Link><Link href="/admin/promotions">Automatic promotions</Link></nav></header>
    <section className="offer-stats" aria-label="Coupon overview"><article><span>Active coupons</span><b>{activeCount}</b><small>available at checkout</small></article><article><span>Drafts</span><b>{draftCount}</b><small>waiting for review</small></article><article><span>Total redemptions</span><b>{redemptionCount}</b><small>across all coupons</small></article></section>
    <details className="offer-builder"><summary><span><b>＋ Create a coupon</b><small>Set the code, discount, limits, and active dates</small></span><i aria-hidden="true">⌄</i></summary><div className="offer-builder-body"><p>New coupons are saved as drafts. Financial rules cannot be edited after creation, so review the summary before activation.</p><CouponCreateForm /></div></details>
    <section className="offer-register"><header><div><p className="eyebrow">COUPON REGISTER</p><h2>Existing coupons</h2></div><span>{coupons.length} total</span></header>{coupons.length ? <div className="coupon-admin-list">{coupons.map((coupon) => <article key={coupon.id}><header><div><b>{coupon.code}</b><span>{coupon.name}</span><small>{coupon.description ?? "No internal note"}</small></div><em className={coupon.status === "ACTIVE" ? "status-active" : "status-inactive"}>{coupon.status}</em></header><dl><div><dt>Customer saving</dt><dd>{coupon.discountType === "PERCENTAGE" ? `${coupon.discountValue.toString()}%` : `BDT ${coupon.discountValue.toString()}`}{coupon.maximumDiscount ? ` · maximum BDT ${coupon.maximumDiscount.toString()}` : ""}</dd></div><div><dt>Minimum order</dt><dd>BDT {coupon.minimumOrderAmount.toString()}</dd></div><div><dt>Usage</dt><dd>{coupon._count.redemptions}{coupon.totalUsageLimit ? ` of ${coupon.totalUsageLimit}` : " used"} · {coupon.perCustomerLimit} per customer</dd></div><div><dt>Audience</dt><dd>{coupon.eligibleAccountType ?? "All customers"}{coupon.firstOrderOnly ? " · first order only" : ""}</dd></div><div className="wide"><dt>Active window</dt><dd>{displayDate(coupon.startsAt)} → {displayDate(coupon.endsAt)}</dd></div></dl><CouponStatusControl couponId={coupon.id} status={coupon.status} version={coupon.version} /></article>)}</div> : <div className="offer-empty"><span>%</span><h3>No coupons yet</h3><p>Open “Create a coupon” above to prepare your first checkout code.</p></div>}</section>
  </section>;
}
