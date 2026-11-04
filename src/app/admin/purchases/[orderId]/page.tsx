import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { getServerSession } from "@/lib/server-session";
import { SupplierOrderRecordForm } from "@/components/supplier-order-record-form";
import styles from "./supplier-records.module.css";
import { SupplierRecordCorrection } from "@/components/supplier-record-correction";
import { SupplierRecordReplacementForm } from "@/components/supplier-record-replacement-form";
import { SupplierDispatchForm } from "@/components/supplier-dispatch-form";
import { procurementGuidance } from "@/modules/sourcing/procurement-guidance";
import { SUPPLIER_RECORD_LIMIT, supplierRecordLimitReached } from "@/modules/sourcing/supplier-record-limit";

import { supplierRecordPage, supplierRecordPagination } from "@/modules/sourcing/supplier-record-pagination";

const recordSelect = { id: true, recordedById: true, inboundDispatch: { select: { carrierName: true, trackingNumber: true, package: { select: { packageCode: true, status: true, isOutboundActive: true } } } }, correction: { select: { replacementRecordId: true } }, orderItemId: true, supplierName: true, supplierOrderReference: true, quantity: true, variantDescription: true, internalNote: true, createdAt: true, originWarehouse: { select: { name: true, country: true } } } as const;
export const dynamic = "force-dynamic";
export default async function SupplierOrderRecordsPage({ params, searchParams }: { params: Promise<{ orderId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await getServerSession();
  if (!session?.roles.includes(ROLE.ADMIN)) redirect("/admin/login");
  const { orderId } = await params;
  const page = supplierRecordPage((await searchParams).page);
  if (page === null) notFound();
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: {
    id: true, orderNumber: true, status: true, type: true, originCountryCode: true,
    _count: { select: { supplierOrderRecords: true } },
    statusHistory: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { id: true, fromStatus: true, toStatus: true, actorId: true } },
    items: { select: { id: true, productTitle: true, quantity: true } },
    sourcingRequest: { select: { productTitle: true, quantity: true, sourceCountryCode: true } },
    supplierOrderRecords: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 100, select: recordSelect },
  } });
  if (!order) notFound();
  const pagination = supplierRecordPagination(page, order._count.supplierOrderRecords, 20);
  const recordLimitReached = supplierRecordLimitReached(order._count.supplierOrderRecords);
  if (page > pagination.pages) notFound();
  const visibleRecords = page === 1 ? order.supplierOrderRecords.slice(0, 20) : await prisma.supplierOrderRecord.findMany({ where: { orderId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], skip: pagination.skip, take: 20, select: recordSelect });
  const pageHref = (value: number) => `/admin/purchases/${order.id}?page=${value}#supplier-records`;
  const country = order.originCountryCode ?? order.sourcingRequest?.sourceCountryCode;
  const warehouses = country ? await prisma.warehouse.findMany({ where: { type: "ORIGIN", country }, select: { id: true, name: true, country: true }, orderBy: { name: "asc" }, take: 100 }) : [];
  const activeRecords = order.supplierOrderRecords.filter(record => !record.correction);
  const hold = order.statusHistory[0];
  const report = order.status === "ON_HOLD" && hold?.fromStatus === "SOURCING" ? await prisma.auditLog.findFirst({ where: { entityId: orderId, entityType: "Order", action: "order.purchase_review.place_on_hold", metadata: { path: ["historyId"], equals: hold.id } }, select: { actorId: true, metadata: true } }) : null;
  const reportedId = report?.metadata && typeof report.metadata === "object" && !Array.isArray(report.metadata) && "supplierRecordId" in report.metadata ? report.metadata.supplierRecordId : null;
  const items = order.items.length ? order.items.map(item => ({ id: item.id, label: item.productTitle, remaining: item.quantity - activeRecords.filter(record => record.orderItemId === item.id).reduce((sum, record) => sum + record.quantity, 0) })) : order.sourcingRequest ? [{ id: "", label: order.sourcingRequest.productTitle ?? "Sourcing request", remaining: order.sourcingRequest.quantity - activeRecords.reduce((sum, record) => sum + record.quantity, 0) }] : [];
  const guidance = procurementGuidance({ status: order.status, records: order.supplierOrderRecords, totalRecords: order._count.supplierOrderRecords, remainingQuantities: items.map(item => item.remaining) });
  return <main className={`admin-content ${styles.root}`}><Link href="/admin/purchases">← Purchase queue</Link><p className="eyebrow">PRIVATE PROCUREMENT EVIDENCE · {order.orderNumber}</p><h1>Supplier order records</h1><p className="admin-intro">Keep real supplier evidence private and follow the next task for this order. Recording a supplier reference does not confirm purchase, dispatch or physical arrival. Dispatch confirmation is a separate action below.</p>
    <section className={styles.guidance} aria-labelledby="procurement-next-task">
      <div className={styles.guidanceHeading}><h2 id="procurement-next-task">What to do next</h2><span>Current stage: {order.status.replaceAll("_", " ")}</span></div>
      <p>{guidance.message}</p>
      <ol className={styles.steps}>{["Record supplier items", "Confirm actual purchase", "Record dispatch details", "Warehouse confirms arrival"].map((label, index) => <li key={label} aria-current={guidance.step === index ? "step" : undefined}><span aria-hidden="true">{index + 1}</span>{label}</li>)}</ol>
      {guidance.counts && <dl className={styles.counts}><div><dt>Active supplier records</dt><dd>{guidance.counts.active}</dd></div><div><dt>Dispatches recorded</dt><dd>{guidance.counts.dispatched}</dd></div><div><dt>Awaiting warehouse receipt</dt><dd>{guidance.counts.awaiting}</dd></div><div><dt>Receipt recorded or later</dt><dd>{guidance.counts.received}</dd></div></dl>}
      <Link href="/admin/orders">Open Order operations →</Link>
    </section>
    {order.status === "ON_HOLD" && <section className="integration-create-card" aria-label="Correction escalation"><h2>Order paused for review</h2><p>Keep the original evidence unchanged. Contact operations with this order number and review the private audit log. A hold does not cancel an external supplier purchase. Only a different Admin may approve the reported name/reference/variant correction below. Item, quantity and warehouse mistakes require separate operations review; this form cannot change them.</p><Link href="/admin/orders">Open order operations</Link></section>}
    <div className="integration-admin-layout"><section className="integration-create-card">{recordLimitReached ? <><h2>Evidence record limit reached</h2><p>This order has {order._count.supplierOrderRecords} retained records. The limit is {SUPPLIER_RECORD_LIMIT}, including superseded records. No new supplier record can be added. Keep existing evidence unchanged and ask operations to review the order; do not delete records or create duplicate orders to bypass the limit.</p><Link href="/admin/orders">Open Order operations →</Link></> : order.status === "SOURCING" && order.type === "BUY_AND_SHIP" ? <SupplierOrderRecordForm orderId={order.id} items={items} warehouses={warehouses.map(warehouse => ({ id: warehouse.id, label: `${warehouse.name} (${warehouse.country})` }))} /> : <><h2>Read-only at this stage</h2><p>New evidence can be recorded only during an approved Buy & Ship Sourcing stage. Current stage: {order.status}.</p></>}</section>
      <section className="platform-admin-list" id="supplier-records"><h2>Recorded supplier references ({visibleRecords.length} shown of {order._count.supplierOrderRecords})</h2><nav className={styles.pagination} aria-label="Supplier record pages">{page > 1 ? <Link href={pageHref(page - 1)}>← Previous records</Link> : <span />}<b>Page {page} of {pagination.pages}</b>{page < pagination.pages ? <Link href={pageHref(page + 1)}>Next records →</Link> : <span />}</nav>{!order.supplierOrderRecords.length && <p>No supplier records yet. Do not enter demo evidence for real customer orders.</p>}{visibleRecords.map(record => <article className="platform-admin-card" key={record.id}><h3>{record.supplierName}</h3><dl><div><dt>Supplier order reference</dt><dd>{record.supplierOrderReference}</dd></div><div><dt>Variant / quantity</dt><dd>{record.variantDescription} · {record.quantity}</dd></div><div><dt>Receiving warehouse</dt><dd>{record.originWarehouse.name} ({record.originWarehouse.country})</dd></div><div><dt>Recorded</dt><dd>{record.createdAt.toLocaleString()}</dd></div></dl>{record.internalNote && <p>{record.internalNote}</p>}<small>{record.correction ? "Superseded · retained for audit, excluded from quantity totals" : "Active immutable record · no financial posting"}</small>{record.inboundDispatch && <p>Domestic tracking: {record.inboundDispatch.carrierName} · {record.inboundDispatch.trackingNumber}<br />Parcel {record.inboundDispatch.package.packageCode} · {record.inboundDispatch.package.status === "EXPECTED" ? "Awaiting physical receipt" : record.inboundDispatch.package.status}</p>}{!record.correction && order.status === "PURCHASED" && !record.inboundDispatch && <SupplierDispatchForm orderId={order.id} recordId={record.id} />}{!record.correction && order.status === "SOURCING" && <SupplierRecordCorrection orderId={order.id} recordId={record.id} />}{!record.correction && order.status === "ON_HOLD" && reportedId === record.id && (session.userId !== report?.actorId && session.userId !== record.recordedById ? <SupplierRecordReplacementForm orderId={order.id} record={record} holdHistoryId={hold.id} retainedRecords={order._count.supplierOrderRecords} /> : <p>A different Admin must approve this correction. The recorder and reporter cannot approve.</p>)}</article>)}</section>
    </div></main>;
}
