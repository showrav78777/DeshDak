import Link from "next/link";
import { notFound } from "next/navigation";

import { InspectorPortalNav } from "@/components/inspector-portal-nav";
import { RmaInspectionForm } from "@/components/rma-inspection-form";
import { prisma } from "@/lib/prisma";
import { requireInspectorPageSession } from "@/lib/inspector-page";

export default async function InspectorRmaPage({ params }: PageProps<"/inspector/rmas/[reference]">) {
  const { session, access } = await requireInspectorPageSession(); const { reference } = await params;
  const rma = await prisma.rma.findFirst({ where: { reference, status: "RETURN_RECEIVED", returnRequired: true, shipment: { destinationWarehouseId: { in: access.warehouseIds } } }, select: { id: true, reference: true, reason: true, description: true, evidenceRefs: true, version: true, returnTrackingNumber: true, shipment: { select: { trackingNumber: true, destinationWarehouse: { select: { name: true, country: true } } } }, items: { select: { package: { select: { packageCode: true } } } } } });
  if (!rma) notFound(); const evidenceCount = Array.isArray(rma.evidenceRefs) ? rma.evidenceRefs.length : 0;
  return <main className="warehouse-portal inspector-portal"><InspectorPortalNav fullName={session.fullName} /><section className="warehouse-package-page"><div className="warehouse-package-back"><Link href="/inspector#returns">← Return queue</Link></div><div className="warehouse-package-title"><div><p className="eyebrow">RETURN INSPECTION</p><h1>{rma.reference}</h1><p>{rma.shipment.destinationWarehouse?.name} · {rma.shipment.destinationWarehouse?.country}</p></div><b className="status-return_received">RETURN RECEIVED</b></div><div className="warehouse-package-layout"><section className="warehouse-package-main"><article className="warehouse-detail-card"><h2>Minimum inspection information</h2><dl><div><dt>Claim reason</dt><dd>{rma.reason.replaceAll("_", " ")}</dd></div><div><dt>Packages</dt><dd>{rma.items.map(({ package: pkg }) => pkg.packageCode).join(", ")}</dd></div><div><dt>Original shipment</dt><dd>{rma.shipment.trackingNumber}</dd></div><div><dt>Return tracking</dt><dd>{rma.returnTrackingNumber ?? "Admin-confirmed receipt"}</dd></div><div><dt>Claim evidence</dt><dd>{evidenceCount} private reference{evidenceCount === 1 ? "" : "s"}</dd></div></dl><p className="rma-description">{rma.description}</p><p className="inspector-scope-note">Customer identity, contact details, price, payment, refund amount, supplier cost, and margin are deliberately hidden.</p></article><article className="warehouse-detail-card"><h2>Record physical findings</h2><RmaInspectionForm rmaId={rma.id} version={rma.version} /></article></section></div></section></main>;
}
