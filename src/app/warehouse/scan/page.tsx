import { WarehousePortalNav } from "@/components/warehouse-portal-nav";
import { WarehouseScanner } from "@/components/warehouse-scanner";
import { requireWarehousePageSession } from "@/lib/warehouse-page";

export default async function WarehouseScanPage() {
  const { session } = await requireWarehousePageSession();
  return <main className="warehouse-portal"><WarehousePortalNav fullName={session.fullName} /><section className="warehouse-scan-page"><p className="eyebrow">SCANNER-FIRST WORKFLOW</p><h1>Scan the physical item.</h1><p>Use a camera, handheld scanner, package code, order code, or domestic inbound tracking number. DeshDak will open only a task assigned to your warehouse.</p><WarehouseScanner /></section></main>;
}
