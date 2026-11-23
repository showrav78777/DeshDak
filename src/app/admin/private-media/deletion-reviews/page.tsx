import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/server-session";
import { prisma } from "@/lib/prisma";
import { createMediaLifecycle, mediaDeletionQuery } from "@/modules/private-storage/lifecycle";
import { PrivateMediaDeletionControls } from "@/components/private-media-deletion-controls";
import "../../private-photos/private-photos.css";
import "../private-media.css";
export const dynamic = "force-dynamic";
const time = (date: Date) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dhaka" }).format(date);
export default async function DeletionReviewsPage({ searchParams }: { searchParams: Promise<{ page?: string; state?: string }> }) {
  const session = await getServerSession();
  if (!session?.roles.includes("admin") || session.portal !== "admin" || !session.mfaVerifiedAt) redirect("/admin/login");
  const parsed = mediaDeletionQuery.safeParse(await searchParams);
  const query = parsed.success ? parsed.data : { page: 1, state: "pending" as const };
  const result = await createMediaLifecycle(prisma).deletionReviews(session.sessionId, query).catch(() => null);
  const href = (page: number) => `?${new URLSearchParams({ page: String(page), state: query.state })}`;
  return <main className="dashboard-shell"><section className="admin-content private-photo-page"><p className="eyebrow">INDEPENDENT MEDIA REVIEW</p><h1>Deletion review requests</h1>
    <ol className="private-media-steps"><li>Use the retention preview and check applicable legal and business requirements.</li><li>Request review of one ready upload. A different administrator with Compliance and MFA must decide.</li><li>Reject stale or expired requests before submitting a replacement. Approval records a review only.</li></ol>
    <p role="status"><strong>File deletion is disabled.</strong> Approval does not queue cleanup or authorize removal. The future worker must recheck current policy, authorization, holds, cases, storage and exact object versions. External/unrecorded investigations still need independent review.</p>
    <p><Link href="/admin/private-media/eligibility">Retention preview →</Link> · <Link href="/admin/private-media">Policy and preservation holds →</Link></p>
    {!parsed.success ? <p role="alert">Invalid filter. Showing the first review page.</p> : null}
    {!result ? <p role="alert">Review controls could not be opened securely. Reload or contact the deployment operator.</p> : <>
      <div className="private-media-layout"><article><h2>Start a review</h2>{result.policySequence ? <PrivateMediaDeletionControls kind="request" policySequence={result.policySequence} /> : <p>Record a Compliance-reviewed retention policy before requesting review.</p>}</article><article><h2>Keep the evidence intact</h2><p>Requests expire after 24 hours using the database clock. The server rechecks eligibility when recording approval and rejects changed policy or upload details. Place a preservation hold whenever a case needs the media.</p><p>A rejected review never removes evidence. Replaying a recorded decision returns the same result and does not create another audit decision.</p><p>All dates below are Bangladesh time.</p></article></div>
      <h2>Review history</h2><form method="get" className="private-photo-filter"><label htmlFor="review-state">Show reviews</label><select id="review-state" name="state" defaultValue={query.state}><option value="pending">Pending decisions</option><option value="all">All requests and decisions</option></select><button type="submit" className="button secondary">Apply filter</button></form>
      {!result.requests.length ? <p className="empty-note">No review requests in this view.</p> : null}<div className="private-photo-list">{result.requests.map(request => <article key={request.id}><h3>{request.decision ? request.decision.decision === "APPROVED" ? "Review approved — cleanup disabled" : "Review rejected" : request.expired ? "Expired — reject before replacing" : "Awaiting independent decision"}</h3><p>Request: <code>{request.id}</code></p><p>Upload: <code>{request.uploadId}</code></p><p>Policy version {request.policySequence} · {request.caseReference}</p><p>Requested {time(request.createdAt)} · Expires {time(request.expiresAt)}</p><p>Earliest review time in snapshot: {time(request.reviewAfter)}</p><Link href={`/admin/private-media/eligibility?uploadId=${encodeURIComponent(request.uploadId)}`}>Check current retention preview →</Link>{request.decision ? <p>Decision recorded {time(request.decision.createdAt)} · {request.decision.caseReference}. No files were deleted.</p> : request.canDecide ? <details><summary>Record independent decision</summary><PrivateMediaDeletionControls kind="decision" requestId={request.id} expired={request.expired} /></details> : <p>A different administrator with Compliance and completed MFA must decide.</p>}</article>)}</div>
      <nav aria-label="Deletion review pages">{query.page > 1 ? <Link href={href(query.page - 1)}>← Previous reviews</Link> : null}<span>Review page {query.page}</span>{result.hasMore ? <Link href={href(query.page + 1)}>Next reviews →</Link> : null}</nav>
    </>}
  </section></main>;
}
