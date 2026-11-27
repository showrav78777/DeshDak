import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/server-session";
import { prisma } from "@/lib/prisma";
import { createVideoSafety, videoSafetyQuery } from "@/modules/private-storage/video-safety";
import { PrivateVideoQuarantine } from "@/components/private-video-quarantine";
import "../private-photos/private-photos.css";
export const dynamic = "force-dynamic";

export default async function PrivateVideoPage({ searchParams }: { searchParams: Promise<{ page?: string; state?: string }> }) {
  const session = await getServerSession();
  if (session?.portal !== "admin" || !session.roles.includes("admin") || !session.mfaVerifiedAt) redirect("/admin/login");
  const parsed = videoSafetyQuery.safeParse(await searchParams), query = parsed.success ? parsed.data : { page: 1, state: "all" as const };
  const result = await createVideoSafety(prisma).list(session.sessionId, query).catch(() => null);
  return <main className="dashboard-shell"><section className="admin-content private-photo-page"><p className="eyebrow">PRIVATE VIDEO SAFETY</p><h1>Review inspection video bundles</h1>
    <p>1. Match the bundle and package to your controlled case. 2. Review preservation holds and the policy date. 3. Quarantine the whole bundle if a security, privacy or integrity review is needed.</p>
    <p>Quarantine preserves all media and history and has no release action here. A policy date is a minimum review date, never permission to delete. Video capture and customer playback remain unavailable until secure handling is approved.</p>
    <p><Link href="/admin/private-media">Retention policy and legal holds →</Link> · <Link href="/admin/launch-readiness">Launch readiness →</Link></p>
    {!parsed.success ? <p role="alert">Invalid filter. Showing the first page.</p> : null}
    <form method="get" className="private-photo-filter"><label htmlFor="video-state">Show bundles</label><select id="video-state" name="state" defaultValue={query.state}><option value="all">All bundles</option><option value="quarantined">Quarantined</option></select><button className="button secondary" type="submit">Apply filter</button></form>
    {!result ? <p role="alert">The queue could not be opened securely. <Link href="/admin/login">Sign in again to verify fresh MFA</Link>, then reload. No change has been made.</p> : <>
      <p>{result.policy ? `Policy #${result.policy.sequence}: inspection media ${result.policy.inspectionDays} days; abandoned bundles ${result.policy.abandonedHours} hours, subject to delivery, cases and holds.` : "No approved retention policy is recorded. Configure it through retention policy and legal holds."} Deletion is disabled.</p>
      {!result.items.length ? <p className="empty-note">No video bundles on this page. This queue does not activate uploads or customer playback.</p> : null}
      <div className="private-photo-list">{result.items.map(item => <article key={item.id}><h2>{item.packageCode}</h2><p><b>Bundle reference:</b> <code>{item.id}</code></p><p>{item.createdAt.toLocaleString()} · {item.status.replaceAll("_", " ").toLowerCase()} · {item.linked ? "Linked evidence" : "Unlinked storage job"}</p>
        <p><b>Retention review:</b> {item.retention.state.replaceAll("_", " ").toLowerCase()}{item.retention.reviewAfter ? ` · earliest review ${item.retention.reviewAfter.toLocaleString()}` : ""}. Independent review is required before any removal.</p>
        {item.quarantine ? <p role="status"><b>Quarantined:</b> {item.quarantine.reason.replaceAll("_", " ").toLowerCase()} · {item.quarantine.caseReference} · {item.quarantine.createdAt.toLocaleString()}. The bundle remains blocked.</p> : <PrivateVideoQuarantine jobId={item.id} />}
      </article>)}</div>
      <nav aria-label="Private video pages">{query.page > 1 ? <Link href={`?state=${query.state}&page=${query.page - 1}`}>← Previous</Link> : null}<span>Page {query.page}</span>{result.hasMore ? <Link href={`?state=${query.state}&page=${query.page + 1}`}>Next →</Link> : null}</nav>
    </>}
  </section></main>;
}
