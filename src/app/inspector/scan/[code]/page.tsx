import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { InspectorPortalNav } from "@/components/inspector-portal-nav";
import { requireInspectorPageSession } from "@/lib/inspector-page";
import { normalizeInspectionScan, resolveInspectionScan } from "@/modules/warehouse/inspection-scan";

export default async function InspectorResolvedScanPage({ params }: PageProps<"/inspector/scan/[code]">) {
  const { session, access } = await requireInspectorPageSession();
  const code = normalizeInspectionScan((await params).code); if (!code) notFound();
  const resolved = await resolveInspectionScan(code, access);
  if (resolved) redirect(resolved.destination);
  return <main className="warehouse-portal inspector-portal"><InspectorPortalNav fullName={session.fullName} /><section className="warehouse-scan-result"><p className="eyebrow">NO ASSIGNED INSPECTION</p><h1>Task not found.</h1><p>This package is unknown, belongs to another warehouse, or is not at the inspection stage.</p><Link className="button primary" href="/inspector/scan">Scan another code</Link></section></main>;
}
