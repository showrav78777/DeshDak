import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { WarehouseReceiveScannedForm } from "@/components/warehouse-portal-operations";
import { WarehousePortalNav } from "@/components/warehouse-portal-nav";
import { requireWarehousePageSession } from "@/lib/warehouse-page";
import { normalizeWarehouseScan, resolveWarehouseScan } from "@/modules/warehouse/scan";

export default async function WarehouseResolvedScanPage({ params }: PageProps<"/warehouse/scan/[code]">) {
  const { session, access } = await requireWarehousePageSession();
  const code = normalizeWarehouseScan((await params).code);
  if (!code) notFound();
  const resolved = await resolveWarehouseScan(code, access);
  if (!resolved) return <main className="warehouse-portal"><WarehousePortalNav fullName={session.fullName} /><section className="warehouse-scan-result"><p className="eyebrow">NO ASSIGNED TASK</p><h1>Code not found.</h1><p>This code is unknown, not ready for warehouse receiving, or belongs to another warehouse.</p><Link className="button primary" href="/warehouse/scan">Scan another code</Link></section></main>;
  if (resolved.kind === "package") redirect(resolved.destination);
  const title = resolved.order.sourcingRequest?.productTitle ?? resolved.order.items[0]?.productTitle ?? "Inbound order";
  const quantity = resolved.order.sourcingRequest?.quantity ?? resolved.order.items[0]?.quantity ?? "—";
  return <main className="warehouse-portal"><WarehousePortalNav fullName={session.fullName} /><section className="warehouse-scan-result"><p className="eyebrow">INBOUND ORDER VERIFIED</p><h1>{resolved.order.orderNumber}</h1><div className="warehouse-scanned-summary"><span>Product</span><b>{title}</b><small>Quantity {quantity}{resolved.order.sourcingRequest?.selectedVariant ? ` · ${resolved.order.sourcingRequest.selectedVariant}` : ""}</small><em>{resolved.order.status.replaceAll("_", " ")}</em></div><h2>Receive physical package</h2><p>Confirm the assigned origin warehouse and add the domestic inbound tracking number if available. This creates the package record and publishes the received update.</p><WarehouseReceiveScannedForm orderNumber={resolved.order.orderNumber} warehouses={resolved.matchingWarehouses.map(({ id, name, country }) => ({ id, label: `${name} (${country})` }))} /></section></main>;
}
