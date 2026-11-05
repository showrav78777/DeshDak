import Link from "next/link";
import { redirect } from "next/navigation";
import { EmailSuppressionRelease } from "@/components/email-suppression-release";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { getServerSession } from "@/lib/server-session";
import { suppressionQuery, suppressionSelect } from "@/modules/notifications/suppression-review";
import "./suppression.css";

export const dynamic = "force-dynamic";
const reasons: Record<string, string> = { "email.bounced": "Permanent bounce", "email.complained": "Spam complaint", "email.suppressed": "Provider suppression" };

export default async function EmailSuppressionPage({ searchParams }: { searchParams: Promise<{ page?: string; state?: string }> }) {
  const session = await getServerSession();
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin" || !session.mfaVerifiedAt) redirect("/admin/login");
  const parsed = suppressionQuery.safeParse(await searchParams);
  const { page, state } = parsed.success ? parsed.data : { page: 1, state: "active" as const };
  const items = await prisma.emailSuppression.findMany({ where: { active: state === "active" }, select: suppressionSelect, orderBy: [{ lastSeenAt: "desc" }, { id: "asc" }], skip: (page - 1) * 50, take: 51 });
  return <main className="dashboard-shell"><section className="admin-content email-suppression-page">
    <p className="eyebrow">NOTIFICATION OPERATIONS</p><h1>Review blocked email addresses.</h1>
    <p>Delivery bounces, complaints and provider blocks stop future emails to the same recipient. Verify the correction or consent before releasing a block. Provider-side blocks must be reviewed separately.</p>
    <Link href="/admin/notifications">← Back to notification controls</Link>
    {!parsed.success ? <p role="alert">The filter was invalid. Showing the first active page.</p> : null}
    <form method="get" className="email-suppression-filter"><label htmlFor="suppression-state">Show</label><select id="suppression-state" name="state" defaultValue={state}><option value="active">Active blocks</option><option value="released">Released blocks</option></select><button className="button secondary" type="submit">Apply filter</button></form>
    <div className="email-suppression-list">{items.slice(0, 50).map(item => <article key={item.id} id={`suppression-${item.id}`}>
      <h2>{reasons[item.reason] ?? "Delivery review required"}</h2>
      {item.sourceDelivery ? <><p><b>Linked account contact:</b> {item.sourceDelivery.notification.user.fullName} · {item.sourceDelivery.notification.user.email}</p><p>This account contact may differ from the original recipient. Verify the recipient against the controlled provider evidence.</p><p><b>Private send reference:</b> <code>{item.sourceDelivery.providerReference ?? "Unavailable"}</code></p></> : <p>The original delivery is no longer retained. Use approved review evidence.</p>}
      <p><b>Last event:</b> {item.lastSeenAt.toLocaleString()}</p>
      {item.active ? <EmailSuppressionRelease id={item.id} version={item.version} /> : <><p><b>Released:</b> {item.releasedAt?.toLocaleString()}</p><p>{item.releaseReason}</p><p><b>Evidence:</b> {item.evidenceReference}</p></>}
    </article>)}</div>
    {!items.length ? <p className="empty-note">No {state} email blocks on this page.</p> : null}
    <nav aria-label="Suppression pages" className="email-suppression-pagination">{page > 1 ? <Link href={`?state=${state}&page=${page - 1}`}>← Previous page</Link> : null}<span>Page {page}</span>{items.length > 50 ? <Link href={`?state=${state}&page=${page + 1}`}>Next page →</Link> : null}</nav>
  </section></main>;
}
