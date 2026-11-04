import { LogisticsPortalNav } from "@/components/logistics-portal-nav";
import { WarehouseScanner } from "@/components/warehouse-scanner";
import { requireLogisticsPageSession } from "@/lib/logistics-page";

export default async function LogisticsScanPage() { const { session } = await requireLogisticsPageSession(); return <main className="warehouse-portal logistics-portal"><LogisticsPortalNav fullName={session.fullName} /><section className="warehouse-scan-page"><p className="eyebrow">LOGISTICS SCANNER</p><h1>Scan the shipment handoff.</h1><p>Use the carrier tracking number, package QR/barcode, or order code. Only shipments connected to assigned warehouses can open.</p><WarehouseScanner portal="logistics" /></section></main>; }
