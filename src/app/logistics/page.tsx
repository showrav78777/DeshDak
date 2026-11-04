import Link from "next/link";

import { ShipmentCreateForm } from "@/components/logistics-operations";
import { LogisticsPortalNav } from "@/components/logistics-portal-nav";
import { requireLogisticsPageSession } from "@/lib/logistics-page";
import { prisma } from "@/lib/prisma";
import { logisticsShipmentFilter } from "@/modules/logistics/access";
import { shipmentStatusLabels } from "@/modules/logistics/state-machine";

const exceptionStatuses = ["FAILED_DELIVERY", "DAMAGED", "LOST", "HELD", "RETURNED", "CUSTOMS_EXCEPTION", "EXCEPTION"] as const;

export default async function LogisticsDashboardPage() {
  const { session, access } = await requireLogisticsPageSession();
  const [assignedWarehouses, destinationWarehouses, shipments, readyPackages] = await Promise.all([
    prisma.warehouse.findMany({ where: { id: { in: access.warehouseIds } }, select: { id: true, warehouseCode: true, name: true, country: true, type: true }, orderBy: { name: "asc" } }),
    prisma.warehouse.findMany({ where: { type: "DESTINATION" }, select: { id: true, warehouseCode: true, name: true, country: true }, orderBy: [{ country: "asc" }, { name: "asc" }] }),
    prisma.shipment.findMany({ where: logisticsShipmentFilter(access), select: { id: true, shipmentCode: true, trackingNumber: true, status: true, carrierName: true, updatedAt: true, originWarehouse: { select: { name: true, country: true } }, destinationWarehouse: { select: { name: true, country: true } }, packages: { select: { package: { select: { packageCode: true } } }, take: 4 } }, orderBy: { updatedAt: "desc" }, take: 60 }),
    prisma.package.findMany({ where: { warehouseId: { in: access.warehouseIds }, isOutboundActive: true, status: "READY_TO_SHIP", shipmentPackages: { none: {} }, order: { status: "READY_TO_SHIP" } }, select: { packageCode: true, warehouse: { select: { name: true } }, order: { select: { orderNumber: true, originCountryCode: true, destinationCountryCode: true } } }, orderBy: { updatedAt: "desc" }, take: 80 }),
  ]);
  const assignedOrigins = assignedWarehouses.filter(({ type }) => type === "ORIGIN");
  const delivered = shipments.filter(({ status }) => status === "DELIVERED").length;
  const exceptions = shipments.filter(({ status }) => exceptionStatuses.includes(status as typeof exceptionStatuses[number])).length;
  return <main className="warehouse-portal logistics-portal"><LogisticsPortalNav fullName={session.fullName} /><section className="warehouse-portal-content">
    <div className="warehouse-portal-hero"><div><p className="eyebrow">LOGISTICS QUEUE</p><h1>Every handoff becomes a trusted update.</h1><p>Only shipments connected to assigned warehouses appear. Customer identity and commercial data remain hidden.</p></div><Link className="warehouse-primary-scan" href="/logistics/scan"><span aria-hidden="true">⌗</span> Scan shipment</Link></div>
    {assignedWarehouses.length ? <>
      <div className="warehouse-stat-grid"><article><span>Active shipments</span><b>{shipments.length - delivered}</b><small>Assigned route work</small></article><article><span>Delivered</span><b>{delivered}</b><small>Claim deadline recorded</small></article><article><span>Exceptions</span><b>{exceptions}</b><small>Operational attention</small></article><article><span>Ready packages</span><b>{readyPackages.length}</b><small>Paid and eligible</small></article></div>
      <section className="warehouse-assignment-strip"><b>Your logistics stations</b>{assignedWarehouses.map((warehouse) => <span key={warehouse.id}>{warehouse.name}<small>{warehouse.warehouseCode} · {warehouse.country} · {warehouse.type.toLowerCase()}</small></span>)}</section>
      {assignedOrigins.length ? <details className="warehouse-detail-card logistics-create-panel"><summary>Create a paid ready-to-ship shipment</summary><ShipmentCreateForm origins={assignedOrigins.map(({ id, name, country }) => ({ id, label: `${name} (${country})` }))} destinations={destinationWarehouses.map(({ id, name, country }) => ({ id, label: `${name} (${country})` }))}/>{readyPackages.length ? <div className="logistics-package-codes">{readyPackages.map((pkg) => <span key={pkg.packageCode}>{pkg.packageCode} · {pkg.order.orderNumber} · {pkg.order.originCountryCode ?? "?"} → {pkg.order.destinationCountryCode ?? "?"} · {pkg.warehouse?.name}</span>)}</div> : <p className="form-help">No paid READY_TO_SHIP packages are waiting.</p>}</details> : <section className="warehouse-detail-card"><h2>Destination operations assignment</h2><p>You can scan and update shipments arriving at your assigned destination. Shipment creation is available only to workers assigned to an origin warehouse.</p></section>}
      <section className="warehouse-queue"><div className="warehouse-section-title"><div><p className="eyebrow">ASSIGNED SHIPMENTS</p><h2>Tracking tasks</h2></div><Link href="/logistics/scan">Scan another →</Link></div>{shipments.length ? <div className="warehouse-task-list">{shipments.map((shipment) => <Link href={`/logistics/shipments/${encodeURIComponent(shipment.trackingNumber)}`} key={shipment.id}><div><small>{shipment.carrierName ?? "Carrier pending"}</small><b>{shipment.trackingNumber}</b><strong>{shipment.originWarehouse?.name ?? "Origin"} → {shipment.destinationWarehouse?.name ?? "Destination"}</strong><span>{shipment.packages.length} package(s)</span></div><div><em className={`status-${shipment.status.toLowerCase()}`}>{shipmentStatusLabels[shipment.status]}</em><small>Open tracking task</small></div></Link>)}</div> : <div className="warehouse-empty"><span>⌗</span><h3>No assigned shipments</h3><p>Create a shipment from paid ready packages or scan an assigned tracking code.</p></div>}</section>
    </> : <section className="warehouse-no-assignment"><h2>No warehouse assignment</h2><p>Your Logistics Worker role is active, but an administrator must assign at least one warehouse.</p></section>}
  </section></main>;
}
