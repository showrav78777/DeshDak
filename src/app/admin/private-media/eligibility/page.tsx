import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/server-session";
import { prisma } from "@/lib/prisma";
import { createMediaLifecycle } from "@/modules/private-storage/lifecycle";
import { mediaPreviewQuery, mediaPreviewReasons } from "@/modules/private-storage/eligibility";
import "../../private-photos/private-photos.css";
import "../private-media.css";
export const dynamic = "force-dynamic";
const workflows: Partial<Record<keyof typeof mediaPreviewReasons, { href: string; label: string }>> = {
  CLEANUP_REVIEW_REQUIRED: { href: "/admin/private-media/deletion-reviews", label: "Cleanup journal" },
  POLICY_REQUIRED: { href: "/admin/private-media", label: "Record policy" }, LEGAL_HOLD: { href: "/admin/private-media", label: "Review holds" }, QUARANTINED: { href: "/admin/private-photos", label: "Photo safety" },
  SUPPORT_REVIEW_REQUIRED: { href: "/admin/support", label: "Customer support" }, RETURN_REVIEW_REQUIRED: { href: "/admin/rmas", label: "Returns and claims" }, REFUND_REVIEW_REQUIRED: { href: "/admin/refunds", label: "Refund review" }, WAREHOUSE_REVIEW_REQUIRED: { href: "/admin/warehouse-exceptions", label: "Parcel exceptions" }, SERVICE_REVIEW_REQUIRED: { href: "/admin/package-services", label: "Package handling" }, PAYMENT_REVIEW_REQUIRED: { href: "/admin/payment-risk", label: "Payment review" }, ORDER_REVIEW_REQUIRED: { href: "/admin/orders", label: "Order operations" }, COMPLIANCE_REVIEW: { href: "/admin/compliance", label: "Compliance review" }, FINANCE_REVIEW: { href: "/admin/payment-reconciliation", label: "Payment reconciliation" }, DELIVERY_REQUIRED: { href: "/admin/orders", label: "Delivery workflow" },
};
const time = (value: Date) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dhaka" }).format(value);
export default async function MediaEligibilityPage({ searchParams }: { searchParams: Promise<{ page?: string; purpose?: string; uploadId?: string }> }) {
  const session = await getServerSession();
  if (!session?.roles.includes("admin") || session.portal !== "admin" || !session.mfaVerifiedAt) redirect("/admin/login");
  const parsed = mediaPreviewQuery.safeParse(await searchParams);
  const query = parsed.success ? parsed.data : { page: 1, purpose: "all" as const, uploadId: undefined };
  const result = await createMediaLifecycle(prisma).preview(session.sessionId, query).catch(() => null);
  const href = (page: number) => `?${new URLSearchParams({ purpose: query.purpose, page: String(page), ...(query.uploadId ? { uploadId: query.uploadId } : {}) })}`;
  return <main className="dashboard-shell"><section className="admin-content private-photo-page"><p className="eyebrow">RETENTION REVIEW PREVIEW</p><h1>Review media retention</h1>
    <ol className="private-media-steps"><li>Check the recorded policy and the first blocking checks below.</li><li>Resolve missing records or cases through their normal workflows. Preserve evidence whenever a hold is needed.</li><li>Refresh the preview. A ready result still requires independent deletion review; no files can be deleted here.</li></ol>
    <p role="status"><strong>Preview only. Automatic deletion is disabled.</strong> This checks known linked records, not external or unrecorded investigations. Records may change while you review them. This result cannot authorize deletion.</p>
    <p><Link href="/admin/private-media">← Policy and preservation holds</Link> · <Link href="/admin/private-photos">Photo safety and quarantine →</Link></p>
    {!parsed.success ? <p role="alert">Invalid filter. Showing the first preview page.</p> : null}
    <form method="get" className="private-photo-filter"><label htmlFor="preview-purpose">Photo type</label><select id="preview-purpose" name="purpose" defaultValue={query.purpose}><option value="all">All object-backed photo uploads</option><option value="identity">Identity photos</option><option value="inspection">Inspection photos</option></select><label htmlFor="preview-upload">Upload reference (optional)</label><input id="preview-upload" name="uploadId" defaultValue={query.uploadId ?? ""} placeholder="Paste one upload UUID to inspect it" maxLength={36} /><button className="button secondary" type="submit">Refresh preview</button></form>
    {!result ? <p role="alert">The preview could not be opened securely. Reload or contact the deployment operator. No files were changed.</p> : <>
      <p>Recorded policy: {result.policySequence ? `version ${result.policySequence}` : "none — suggested defaults are not used for eligibility"}. Evaluated {time(result.evaluatedAt)} (Bangladesh time).</p><p>Each page checks ten uploads, oldest activity first. Blocking checks stop early; more blockers may appear after the listed ones are resolved. Large histories need manual review. Legacy database-only media and video are outside this preview.</p>
      {!result.rows.length ? <p className="empty-note">No object-backed photo uploads on this page.</p> : null}
      <div className="private-photo-list">{result.rows.map(row => <article key={row.uploadId}><h2>{row.purpose === "identity" ? "Identity photo" : "Inspection photo"}</h2><p><span className={`media-preview-state ${row.state.toLowerCase()}`}>{row.state === "READY_FOR_REVIEW" ? "Ready for independent review" : row.state === "WAITING" ? "Waiting period running" : "Preserve — review blocked"}</span></p><p>Upload reference: <code>{row.uploadId}</code></p><ul className="media-review-reasons">{row.reasons.map(reason => <li key={reason}>{mediaPreviewReasons[reason]}{workflows[reason] ? <> <Link href={workflows[reason]!.href}>{workflows[reason]!.label} →</Link></> : null}</li>)}</ul>{row.reviewAfter ? <p>Earliest review time: {time(row.reviewAfter)} (Bangladesh time).</p> : null}<p><strong>Deletion is not authorized.</strong></p></article>)}</div>
      <nav aria-label="Media review preview pages">{query.page > 1 ? <Link href={href(query.page - 1)}>← Previous uploads</Link> : null}<span>Preview page {query.page}</span>{result.hasMore ? <Link href={href(query.page + 1)}>Next uploads →</Link> : null}</nav>
    </>}
  </section></main>;
}
