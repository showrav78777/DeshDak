import Link from "next/link";

export function CustomerAdminHeader({ name }: { name: string }) {
  return <nav className="site-nav"><Link className="brand" href="/admin"><span className="brand-mark">D</span><span>DeshDak Admin</span></Link><Link href="/admin">Control center</Link><span className="dashboard-user">{name}</span></nav>;
}
