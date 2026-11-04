import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { getServerSession } from "@/lib/server-session";
import { parseAuditQuery, queryAuditEvents } from "@/modules/audit/query";

export const dynamic = "force-dynamic";

function pageHref(input: Record<string, string>, page: number) {
  return `/admin/audit-logs?${new URLSearchParams({ ...input, page: String(page) })}`;
}

export default async function AdminAuditLogsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [session, rawParams] = await Promise.all([getServerSession(), searchParams]);
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") redirect("/admin/login");
  const urlParams = new URLSearchParams();
  for (const [key, value] of Object.entries(rawParams)) if (typeof value === "string") urlParams.set(key, value);
  const query = parseAuditQuery(urlParams);
  const result = await queryAuditEvents(prisma, query);
  const retained = Object.fromEntries(Object.entries({ q: query.q, action: query.action, entityType: query.entityType, from: query.from, to: query.to }).filter(([, value]) => value));

  return <main className="dashboard-shell"><section className="admin-content audit-log-page"><p className="eyebrow">SECURITY & OPERATIONS</p><h1>Audit log.</h1><p className="admin-intro">Review recorded business and security actions without exposing passwords, tokens, cookies, payment credentials, or provider secrets.</p><form className="audit-filter-form"><label>Search<input name="q" defaultValue={query.q} placeholder="Action, entity, reference, or actor" /></label><label>Action<input name="action" defaultValue={query.action} placeholder="Example: address.updated" /></label><label>Entity type<select name="entityType" defaultValue={query.entityType}><option value="">All entity types</option>{result.entityTypes.map((type) => <option key={type}>{type}</option>)}</select></label><label>From<input name="from" type="date" defaultValue={query.from} /></label><label>To<input name="to" type="date" defaultValue={query.to} /></label><div><button className="button primary" type="submit">Apply filters</button>{Object.keys(retained).length ? <Link href="/admin/audit-logs">Clear</Link> : null}</div></form><div className="audit-summary"><b>{result.pagination.total}</b><span>matching immutable event{result.pagination.total === 1 ? "" : "s"}</span><small>Newest events appear first. Display metadata is defensively redacted and bounded.</small></div>{result.events.length ? <div className="audit-table-wrap"><table className="audit-table"><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Entity</th><th>Safe evidence</th></tr></thead><tbody>{result.events.map((event) => <tr key={event.id}><td><time dateTime={event.createdAt.toISOString()}>{event.createdAt.toLocaleString()}</time><small>{event.id}</small></td><td>{event.actor ? <><b>{event.actor.fullName}</b><small>{event.actor.personCode}</small><small>{event.actor.email}</small></> : <span>System process</span>}</td><td><code>{event.action}</code></td><td><b>{event.entityType}</b><small>{event.entityId ?? "No entity reference"}</small></td><td>{event.metadata ? <details><summary>View redacted metadata</summary><pre>{JSON.stringify(event.metadata, null, 2)}</pre></details> : <span>No metadata</span>}</td></tr>)}</tbody></table></div> : <div className="dashboard-card"><h2>No audit events found</h2><p>Change or clear the filters to review another part of the audit history.</p></div>}{result.pagination.pages > 1 ? <nav className="audit-pagination" aria-label="Audit log pages"><span>{query.page > 1 ? <Link href={pageHref(retained, query.page - 1)}>← Previous</Link> : null}</span><b>Page {query.page} of {result.pagination.pages}</b><span>{query.page < result.pagination.pages ? <Link href={pageHref(retained, query.page + 1)}>Next →</Link> : null}</span></nav> : null}</section></main>;
}
