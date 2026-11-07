import Link from "next/link";
import { PrivatePhotoReview } from "@/components/private-photo-review";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/server-session";
import { prisma } from "@/lib/prisma";
import { createPhotoQuarantine, photoReviewPage, photoReviewDecisions } from "@/modules/private-storage/quarantine";
import "../private-photos.css";
export const dynamic = "force-dynamic";
export default async function PhotoReviewHistory({ params, searchParams }: { params: Promise<{ uploadId: string }>; searchParams: Promise<{ page?: string }> }) {
  const session = await getServerSession();
  if (!session?.roles.includes("admin") || session.portal !== "admin" || !session.mfaVerifiedAt) redirect("/admin/login");
  const { uploadId } = await params; const parsed = photoReviewPage.safeParse(await searchParams); const query = parsed.success ? parsed.data : { page: 1 };
  const result = await createPhotoQuarantine(prisma).history(session.sessionId, uploadId, query).catch(() => null);
  return <main className="dashboard-shell"><section className="admin-content private-photo-page"><p className="eyebrow">PRIVATE MEDIA REVIEW</p><h1>Quarantine review history</h1><p>Reviews are permanent records of decisions. A rescan or replacement requirement is a task to complete separately; the file remains blocked.</p><Link href="/admin/private-photos?state=quarantined">← Back to quarantined photos</Link>
    {!parsed.success ? <p role="alert">Invalid page. Showing the first review page.</p> : null}
    {!result ? <p role="alert">History could not be opened securely. Check the upload reference and your access; no change has been made.</p> : <><p><b>Upload reference:</b> <code>{uploadId}</code></p>{!result.items.length ? <p className="empty-note">No review has been recorded. The photo remains quarantined.</p> : null}<div className="private-photo-list"><article><h2>Record the next action</h2><PrivatePhotoReview key={`${uploadId}-${result.latestSequence}`} uploadId={uploadId} sequence={result.latestSequence} /></article>{result.items.map(review => <article key={review.id}><h2>Review #{review.sequence} · {photoReviewDecisions[review.decision as keyof typeof photoReviewDecisions] ?? "Recorded decision"}</h2><p><b>Incident reference:</b> <code>{review.caseReference}</code></p><p><b>Reviewer:</b> {review.actor.fullName} · {review.createdAt.toLocaleString()}</p><p>Downloads and ordinary recovery remain blocked.</p></article>)}</div><nav aria-label="Review history pages">{query.page > 1 ? <Link href={`?page=${query.page - 1}`}>← Previous</Link> : null}<span>Page {query.page}</span>{result.hasMore ? <Link href={`?page=${query.page + 1}`}>Next →</Link> : null}</nav></>}
  </section></main>;
}
