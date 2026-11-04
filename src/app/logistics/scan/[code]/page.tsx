import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { LogisticsPortalNav } from "@/components/logistics-portal-nav";
import { requireLogisticsPageSession } from "@/lib/logistics-page";
import { normalizeLogisticsScan, resolveLogisticsScan } from "@/modules/logistics/scan";

export default async function LogisticsResolvedScanPage({ params }: PageProps<"/logistics/scan/[code]">) { const { session, access } = await requireLogisticsPageSession(); const code = normalizeLogisticsScan((await params).code); if (!code) notFound(); const resolved = await resolveLogisticsScan(code, access); if (resolved) redirect(resolved.destination); return <main className="warehouse-portal logistics-portal"><LogisticsPortalNav fullName={session.fullName} /><section className="warehouse-scan-result"><p className="eyebrow">NO ASSIGNED SHIPMENT</p><h1>Tracking task not found.</h1><p>This code is unknown or the shipment is outside your assigned warehouses.</p><Link className="button primary" href="/logistics/scan">Scan another code</Link></section></main>; }
