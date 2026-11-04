import Link from "next/link";

import { WarehouseLogoutButton } from "@/components/warehouse-portal-operations";

export function WarehousePortalNav({ fullName }: { fullName: string }) {
  return <header className="warehouse-portal-nav"><Link className="brand" href="/warehouse"><span className="brand-mark">D</span><span>DeshDak Warehouse</span></Link><nav><Link href="/warehouse">Queue</Link><Link href="/warehouse/package-services">Package services</Link><Link href="/warehouse/exceptions">Exceptions</Link><Link className="warehouse-scan-link" href="/warehouse/scan">Scan</Link></nav><div><span>{fullName}</span><WarehouseLogoutButton /></div></header>;
}
