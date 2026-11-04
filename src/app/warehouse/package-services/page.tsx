import Link from "next/link";

import { PackageServiceCompleteForm } from "@/components/package-service-forms";
import { WarehousePortalNav } from "@/components/warehouse-portal-nav";
import { prisma } from "@/lib/prisma";
import { requireWarehousePageSession } from "@/lib/warehouse-page";

export default async function WarehousePackageServicesPage() {
  const { session, access } = await requireWarehousePageSession();
  const requests = await prisma.packageServiceRequest.findMany({
    where: { status: "APPROVED", packages: { some: { role: "SOURCE", package: { warehouseId: { in: access.warehouseIds }, isOutboundActive: true } } } },
    include: { order: { select: { orderNumber: true } }, packages: { where: { role: "SOURCE" }, include: { package: { select: { packageCode: true, status: true, warehouseId: true, warehouse: { select: { name: true } } } } } } },
    orderBy: { reviewedAt: "asc" }, take: 50,
  });
  return <main className="warehouse-portal"><WarehousePortalNav fullName={session.fullName} /><section className="warehouse-portal-content">
    <div className="warehouse-section-title"><div><p className="eyebrow">ADMIN-APPROVED WORK</p><h1>Package handling queue</h1><p>Scan and physically verify every source package before completing a task. Completion creates fresh package codes for inspection and measurement.</p></div><Link href="/warehouse/scan">Scan package →</Link></div>
    {requests.length ? <div className="warehouse-package-list">{requests.map((item) => {
      const sourcePackageCodes = item.packages.map(({ package: pkg }) => pkg.packageCode);
      return <article className="warehouse-package-card" key={item.id}><div className="warehouse-package-head"><div><p>{item.reference} · {item.order.orderNumber}</p><h3>{item.type.replaceAll("_", " ")}</h3><span>{item.packages[0]?.package.warehouse?.name ?? "Assigned warehouse"}</span></div><b className="status-approved">APPROVED</b></div><dl><div><dt>Source packages</dt><dd>{item.packages.map(({ package: pkg }) => `${pkg.packageCode} (${pkg.status})`).join(", ")}</dd></div><div><dt>New package count</dt><dd>{item.requestedOutputCount}</dd></div></dl><PackageServiceCompleteForm requestId={item.id} sourcePackageCodes={sourcePackageCodes} /></article>;
    })}</div> : <div className="warehouse-empty"><h3>No approved handling tasks</h3><p>Admin-approved consolidation, splitting, and repacking work will appear here.</p></div>}
  </section></main>;
}
