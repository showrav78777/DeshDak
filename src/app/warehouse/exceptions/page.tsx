import Link from "next/link";

import { PackageExceptionCreateForm } from "@/components/package-exception-forms";
import { WarehousePortalNav } from "@/components/warehouse-portal-nav";
import { prisma } from "@/lib/prisma";
import { requireWarehousePageSession } from "@/lib/warehouse-page";

export default async function WarehouseExceptionsPage() {
  const { session, access } = await requireWarehousePageSession();
  const [warehouses, exceptions] = await Promise.all([
    prisma.warehouse.findMany({ where: { id: { in: access.warehouseIds } }, select: { id: true, name: true, country: true }, orderBy: { name: "asc" } }),
    prisma.packageException.findMany({ where: { warehouseId: { in: access.warehouseIds } }, select: { id: true, reference: true, type: true, status: true, description: true, resolutionNote: true, customerNote: true, createdAt: true, resolvedAt: true, order: { select: { orderNumber: true } }, package: { select: { packageCode: true } }, warehouse: { select: { name: true } }, reportedBy: { select: { fullName: true } } }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  return <main className="warehouse-portal"><WarehousePortalNav fullName={session.fullName} /><section className="warehouse-portal-content"><div className="warehouse-section-title"><div><p className="eyebrow">CONTROLLED EXCEPTIONS</p><h1>Parcel exception register</h1><p>Record a mismatch without changing package counts or customer status. Admin must investigate and publish the outcome.</p></div><Link href="/warehouse/scan">Scan package →</Link></div><div className="warehouse-ops-layout"><section className="warehouse-receive-card"><h2>Open an exception</h2><PackageExceptionCreateForm warehouses={warehouses.map((warehouse) => ({ id: warehouse.id, label: `${warehouse.name} (${warehouse.country})` }))} /></section><section className="warehouse-package-column"><h2>Recent warehouse reports</h2>{exceptions.length ? <div className="warehouse-package-list">{exceptions.map((item) => <article className="warehouse-package-card" key={item.id}><div className="warehouse-package-head"><div><p>{item.reference} · {item.order.orderNumber}</p><h3>{item.type.replaceAll("_", " ")}</h3><span>{item.package?.packageCode ?? "No package linked"} · {item.warehouse.name}</span></div><b className={`status-${item.status.toLowerCase()}`}>{item.status}</b></div><p>{item.description}</p><small>Reported by {item.reportedBy.fullName} · {item.createdAt.toLocaleString()}</small>{item.customerNote ? <p><b>Published update:</b> {item.customerNote}</p> : null}</article>)}</div> : <div className="warehouse-empty"><h3>No parcel exceptions</h3><p>Normal receiving work continues through the scanner.</p></div>}</section></div></section></main>;
}
