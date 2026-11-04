import Link from "next/link";
import { redirect } from "next/navigation";

import { AdminLogoutButton } from "@/components/admin-logout-button";
import { PackageServiceReviewForm } from "@/components/package-service-forms";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { getServerSession } from "@/lib/server-session";

export default async function AdminPackageServicesPage() {
  const session = await getServerSession();
  if (!session?.roles.includes(ROLE.ADMIN)) redirect("/admin/login");
  const requests = await prisma.packageServiceRequest.findMany({
    include: {
      customer: { select: { fullName: true } },
      order: { select: { orderNumber: true, status: true } },
      reviewedBy: { select: { fullName: true } }, completedBy: { select: { fullName: true } },
      packages: { include: { package: { select: { packageCode: true, status: true, isOutboundActive: true, warehouse: { select: { name: true } } } } } },
    }, orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 100,
  });
  const pending = requests.filter(({ status }) => status === "REQUESTED").length;
  return <main className="dashboard-shell">
    <nav className="site-nav"><Link className="brand" href="/admin"><span className="brand-mark">D</span><span>DeshDak Admin</span></Link><div className="customer-nav-account"><span>{session.fullName}</span><AdminLogoutButton /></div></nav>
    <section className="admin-content"><p className="eyebrow">CONTROLLED PACKAGE HANDLING</p><h1>Consolidation, splitting, and repacking</h1><p className="admin-intro">Review each customer request before physical work begins. Warehouse creates new traceable package codes only after approval; original records remain immutable.</p>
      <div className="maintenance-status-grid"><article><span>Waiting for review</span><b>{pending}</b><small>Admin decision required</small></article><article><span>Approved for Warehouse</span><b>{requests.filter(({ status }) => status === "APPROVED").length}</b><small>Physical work pending</small></article><article><span>Completed</span><b>{requests.filter(({ status }) => status === "COMPLETED").length}</b><small>Replacement packages created</small></article></div>
      <section className="maintenance-history"><div className="updates-head"><div><h2>Service register</h2><p>Internal and customer-safe messages are stored separately.</p></div><span>{requests.length}</span></div>
        {requests.length ? <div className="warehouse-package-list">{requests.map((item) => {
          const sources = item.packages.filter(({ role }) => role === "SOURCE"); const results = item.packages.filter(({ role }) => role === "RESULT");
          return <article className="warehouse-package-card" key={item.id}><div className="warehouse-package-head"><div><p>{item.reference} · {item.order.orderNumber}</p><h3>{item.type.replaceAll("_", " ")}</h3><span>{item.customer.fullName}</span></div><b className={`status-${item.status.toLowerCase()}`}>{item.status}</b></div>
            <dl><div><dt>Source packages</dt><dd>{sources.map(({ package: pkg }) => pkg.packageCode).join(", ")}</dd></div><div><dt>Requested output</dt><dd>{item.requestedOutputCount}</dd></div><div><dt>Warehouse</dt><dd>{sources[0]?.package.warehouse?.name ?? "Not assigned"}</dd></div><div><dt>Order state</dt><dd>{item.order.status}</dd></div></dl>
            {item.customerNote ? <p><b>Customer instruction:</b> {item.customerNote}</p> : null}
            {item.status === "REQUESTED" ? <PackageServiceReviewForm requestId={item.id} /> : <><p><b>Customer update:</b> {item.reviewCustomerNote ?? "No update recorded"}</p><p><b>Internal decision:</b> {item.adminNote}</p>{results.length ? <p><b>Replacement packages:</b> {results.map(({ package: pkg }) => pkg.packageCode).join(", ")}</p> : null}<small>{item.completedBy ? `Completed by ${item.completedBy.fullName}` : item.reviewedBy ? `Reviewed by ${item.reviewedBy.fullName}` : "Awaiting action"}</small></>}
          </article>;
        })}</div> : <p className="empty-copy">No package handling requests have been submitted.</p>}
      </section>
    </section>
  </main>;
}
