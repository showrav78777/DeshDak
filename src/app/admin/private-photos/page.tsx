import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/server-session";
import { prisma } from "@/lib/prisma";
import { createPhotoQuarantine, photoQueueQuery, photoQuarantineReasons, photoReviewDecisions } from "@/modules/private-storage/quarantine";
import { PrivatePhotoReview } from "@/components/private-photo-review";
import { PrivatePhotoQuarantine } from "@/components/private-photo-quarantine";
import "./private-photos.css";
export const dynamic = "force-dynamic";
export default async function PrivatePhotoPage({ searchParams }: { searchParams: Promise<{ page?: string; state?: string }> }) {
  const session = await getServerSession();
  if (!session?.roles.includes("admin") || session.portal !== "admin" || !session.mfaVerifiedAt) redirect("/admin/login");
  const parsed = photoQueueQuery.safeParse(await searchParams); const query = parsed.success ? parsed.data : { page: 1, state: "all" as const };
  const result = await createPhotoQuarantine(prisma).list(session.sessionId, query).catch(() => null);
  return <main className="dashboard-shell"><section className="admin-content private-photo-page"><p className="eyebrow">PRIVATE MEDIA SAFETY</p><h1>Review private photo uploads</h1>
    <p>1. Match the upload reference to your controlled incident review. 2. Choose a reason. 3. Confirm quarantine to block downloads and ordinary recovery. Files and history are preserved.</p>
    <p>Quarantine has no release action here. This queue covers the staged object-storage pipeline, including linked legacy photos. After quarantine, record the next review action and use the history link to see earlier decisions. This does not activate production uploads or remove evidence.</p>
    <Link href="/admin/launch-readiness">← Launch readiness and setup requirements</Link>
    {!parsed.success ? <p role="alert">Invalid filter. Showing the first page.</p> : null}
    <form method="get" className="private-photo-filter"><label htmlFor="photo-state">Show uploads</label><select id="photo-state" name="state" defaultValue={query.state}><option value="all">All reservations</option><option value="quarantined">Quarantined</option></select><button className="button secondary" type="submit">Apply filter</button></form>
    {!result ? <p role="alert">The queue could not be opened securely. Reload or contact the deployment operator; no change has been made.</p> : <>
      {!result.items.length ? <p className="empty-note">No photo reservations on this page. Production intake remains disabled until the remaining integration and acceptance work is complete.</p> : null}
      <div className="private-photo-list">{result.items.map(item => <article key={item.id}><h2>{item.purpose === "identity" ? "Identity document photo" : "Inspection photo"}</h2><p><b>Upload reference:</b> <code>{item.id}</code></p><p><b>Reserved:</b> {item.createdAt.toLocaleString()} · <b>Storage state:</b> {item.status.replaceAll("_", " ").toLowerCase()} · {item.linked ? "Linked to a record" : "Unlinked reservation"}</p>
        {item.quarantine ? <><p role="status"><b>Quarantined:</b> {photoQuarantineReasons[item.quarantine.reason as keyof typeof photoQuarantineReasons] ?? "Security review"} · {item.quarantine.createdAt.toLocaleString()}. Downloads remain blocked.</p><p><b>Latest review:</b> {item.quarantine.reviews[0] ? `#${item.quarantine.reviews[0].sequence} · ${photoReviewDecisions[item.quarantine.reviews[0].decision as keyof typeof photoReviewDecisions] ?? "Recorded decision"}` : "Not reviewed yet"}</p><Link href={`/admin/private-photos/${item.id}`}>View review history →</Link><PrivatePhotoReview key={`${item.id}-${item.quarantine.reviews[0]?.sequence ?? 0}`} uploadId={item.id} sequence={item.quarantine.reviews[0]?.sequence ?? 0} /></> : <PrivatePhotoQuarantine uploadId={item.id} />}</article>)}</div>
      <nav aria-label="Private photo pages">{query.page > 1 ? <Link href={`?state=${query.state}&page=${query.page - 1}`}>← Previous</Link> : null}<span>Page {query.page}</span>{result.hasMore ? <Link href={`?state=${query.state}&page=${query.page + 1}`}>Next →</Link> : null}</nav>
    </>}
  </section></main>;
}
