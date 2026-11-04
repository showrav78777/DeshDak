import Link from "next/link";
import type { Metadata } from "next";
import { StoreHeader } from "@/components/store-header";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "@/lib/server-session";
import { hasRuntimeReadyPaymentOption } from "@/modules/payments/availability";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Bangladesh stores",
  description: "Discover approved Bangladesh sellers. Shop locally in Bangladesh or use an enabled international delivery destination.",
  alternates: { canonical: "/stores" },
  openGraph: {
    title: "Verified Bangladesh stores on DeshDak",
    description: "Browse approved Bangladesh stores for local delivery or enabled international delivery.",
    url: "/stores",
  },
};

export default async function PublicStoresPage({ searchParams }: PageProps<"/stores">) {
  const [params, session] = await Promise.all([searchParams, getServerSession()]);
  const query = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const page = Math.max(1, Number(typeof params.page === "string" ? params.page : 1) || 1);
  const pageSize = 18;
  const where = {
    status: "APPROVED" as const,
    storeSlug: { not: null },
    products: { some: { status: "ACTIVE" as const, complianceStatus: "CLEAR" as const, deletedAt: null } },
    ...(query ? { OR: [{ storeCode: { contains: query, mode: "insensitive" as const } }, { businessName: { contains: query, mode: "insensitive" as const } }, { storeDescription: { contains: query, mode: "insensitive" as const } }] } : {}),
  };
  const [stores, total, destinations] = await Promise.all([
    prisma.sellerProfile.findMany({
      where,
      select: {
        id: true,
        storeCode: true,
        businessName: true,
        storeSlug: true,
        storeDescription: true,
        originCountryCode: true,
        processingDays: true,
        _count: { select: { products: { where: { status: "ACTIVE", complianceStatus: "CLEAR", deletedAt: null } } } },
      },
      orderBy: { businessName: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.sellerProfile.count({ where }),
    prisma.shippingLane.findMany({
      where: { isActive: true, checkoutEnabled: true, financeApproved: true, complianceApproved: true, operationsApproved: true, originCountry: { isoCode: "BD", isActive: true }, destinationCountry: { isActive: true } },
      select: { destinationCountry: { select: { isoCode: true, name: true, paymentMethods: { where: { checkoutEnabled: true, financeApproved: true, complianceApproved: true, refundsApproved: true, reconciliationApproved: true, paymentMethod: { is: { isActive: true } } }, select: { customerCurrency: true, paymentMethod: { select: { adapterCode: true } } } } } } },
      distinct: ["destinationCountryId"],
    }),
  ]);
  const readyDestinations = (await Promise.all(destinations.map(async (lane) => await hasRuntimeReadyPaymentOption(prisma, lane.destinationCountry.paymentMethods) ? lane : null))).filter((lane): lane is NonNullable<typeof lane> => Boolean(lane));
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return <main className="public-catalog marketplace-stores">
    <StoreHeader session={session} />
    <section className="stores-hero"><div><p className="eyebrow">SHOP BANGLADESH · SHIP WORLDWIDE</p><h1>Discover verified Bangladesh stores.</h1><p>Bangladesh customers can order directly to a Bangladesh address. International delivery is available only where DeshDak has enabled a verified route.</p></div><form action="/stores"><label htmlFor="storeSearch">Search stores</label><div><input id="storeSearch" name="q" defaultValue={query} placeholder="Store ID, name, or product specialty" maxLength={100} /><button type="submit">Search</button></div></form></section>
    <section className="stores-content">
      <div className="store-destination-bar"><b>Local delivery in Bangladesh</b><span>Available directly from approved Bangladesh sellers.</span><b>International destinations</b>{readyDestinations.length ? <span>{readyDestinations.map(({ destinationCountry }) => destinationCountry.name).join(" · ")}</span> : <span>Will appear after the administrator completes route, payment, and currency readiness.</span>}</div>
      <div className="section-heading"><div><h2>{query ? `Stores matching “${query}”` : "Verified stores"}</h2><p className="section-note">{total} public store{total === 1 ? "" : "s"}</p></div>{query ? <Link href="/stores">Clear search</Link> : null}</div>
      {stores.length ? <div className="store-directory-grid">{stores.map((store) => <Link className="store-directory-card" href={`/stores/${store.storeSlug}`} key={store.id}><header><div className="store-avatar store-company-logo" aria-label={`${store.businessName} store mark`}>{store.businessName.slice(0, 1).toUpperCase()}</div><div><span className="verified-store">✓ Verified Bangladesh seller</span><h2>{store.businessName}</h2><small>Store ID · {store.storeCode}</small></div></header><p>{store.storeDescription ?? "Approved Bangladesh products with local delivery options."}</p><div className="store-directory-facts"><span><b>{store._count.products}</b>Active product{store._count.products === 1 ? "" : "s"}</span><span><b>BD</b>Local delivery</span><span><b>{store.processingDays} day{store.processingDays === 1 ? "" : "s"}</b>Preparation</span></div><footer><span>Bangladesh seller</span><strong>Visit store →</strong></footer></Link>)}</div> : <div className="catalog-empty"><span>⌕</span><h2>No public stores found</h2><p>Approved Bangladesh sellers appear here once they have an approved public product.</p></div>}
      {pages > 1 ? <nav className="catalog-pagination" aria-label="Store pages">{page > 1 ? <Link href={`/stores?${new URLSearchParams({ ...(query ? { q: query } : {}), page: String(page - 1) })}`}>← Previous</Link> : <span />}<b>Page {page} of {pages}</b>{page < pages ? <Link href={`/stores?${new URLSearchParams({ ...(query ? { q: query } : {}), page: String(page + 1) })}`}>Next →</Link> : <span />}</nav> : null}
    </section>
  </main>;
}
