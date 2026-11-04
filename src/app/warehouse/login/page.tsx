import Link from "next/link";
import { redirect } from "next/navigation";

import { WarehouseLoginForm } from "@/components/warehouse-login-form";
import { ROLE } from "@/lib/roles";
import { getServerSession } from "@/lib/server-session";

export default async function WarehouseLoginPage() {
  const session = await getServerSession();
  if (session?.portal === "warehouse" && session.roles.includes(ROLE.WAREHOUSE_WORKER)) redirect("/warehouse");
  return <main className="seller-login-shell warehouse-login-shell"><section className="seller-login-intro"><Link className="brand" href="/"><span className="brand-mark">D</span><span>DeshDak</span></Link><div><p className="eyebrow">FIELD OPERATIONS · WAREHOUSE PWA</p><h1>Scan first. Handle accurately.</h1><p>Receive, measure, locate, and label packages using only your assigned warehouse tasks.</p></div><div className="seller-login-points"><span>✓ QR and Code 128 scanning</span><span>✓ Assigned warehouse access only</span><span>✓ Every operation timestamped and audited</span></div></section><section className="seller-login-card-wrap"><WarehouseLoginForm /></section></main>;
}
