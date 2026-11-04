import Link from "next/link";
import { AiCapability } from "@prisma/client";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AiConfigurationForm } from "@/components/ai-configuration-form";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import { AI_CONFIGURATION_DEFAULTS, toAiConfigurationView } from "@/modules/ai/configuration";

export const dynamic = "force-dynamic";

export default async function AdminAiPage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value; const session = token ? await verifySession(token) : null; if (!session?.roles.includes(ROLE.ADMIN)) redirect("/");
  const stored = await prisma.aiConfiguration.findMany(); const byCapability = new Map(stored.map((item) => [item.capability, item])); const configurations = Object.values(AiCapability).map((capability) => toAiConfigurationView(byCapability.get(capability) ?? AI_CONFIGURATION_DEFAULTS[capability]));
  return <main className="dashboard-shell"><nav className="site-nav"><Link className="brand" href="/admin"><span className="brand-mark">D</span><span>DeshDak Admin</span></Link><span className="dashboard-user">{session.fullName}</span></nav><section className="admin-content"><p className="eyebrow">AI & DISCOVERY CONTROL</p><h1>Configure intelligence safely.</h1><p className="admin-intro">Manage public limits, upload rules, retention, and approved adapter references from the web app. Real credentials stay in a production secret manager and are never displayed or stored here.</p><aside className="ai-security-banner"><b>External activation is intentionally locked.</b><span>Saving an endpoint does not call it. A reviewed adapter, secret-manager connection, health check, response validation, abuse controls, and vector index are required first. These owner tasks are recorded in idea.txt.</span></aside><div className="ai-config-grid">{configurations.map((configuration) => <AiConfigurationForm configuration={configuration} key={configuration.capability} />)}</div></section></main>;
}
