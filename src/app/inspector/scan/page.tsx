import { InspectorPortalNav } from "@/components/inspector-portal-nav";
import { WarehouseScanner } from "@/components/warehouse-scanner";
import { requireInspectorPageSession } from "@/lib/inspector-page";

export default async function InspectorScanPage() {
  const { session } = await requireInspectorPageSession();
  return <main className="warehouse-portal inspector-portal"><InspectorPortalNav fullName={session.fullName} /><section className="warehouse-scan-page"><p className="eyebrow">INSPECTOR SCANNER</p><h1>Scan the received package.</h1><p>Use the package QR, Code 128 barcode, order code, or inbound tracking number. Only assigned packages ready for inspection can open.</p><WarehouseScanner portal="inspector" /></section></main>;
}
