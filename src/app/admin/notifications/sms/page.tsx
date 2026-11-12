import Link from "next/link";
import { PhoneOtpInvestigation } from "@/components/phone-otp-investigation";
import { PHONE_OTP_REVIEW_ACTION, canAcknowledgePhoneOtpAttempt } from "@/modules/notifications/phone-otp-investigation";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { getServerSession } from "@/lib/server-session";
import { phoneOtpOperationsQuery, phoneOtpOperationsWhere, phoneOtpJobSelect, phoneOtpJobLabel } from "@/modules/notifications/phone-otp-operations";
import "./sms-operations.css";

export const dynamic = "force-dynamic";
export default async function SmsOtpOperationsPage({ searchParams }: { searchParams: Promise<{ page?: string; state?: string }> }) {
  const session = await getServerSession();
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin" || !session.mfaVerifiedAt) redirect("/admin/login");
  const parsed = phoneOtpOperationsQuery.safeParse(await searchParams);
  const { page, state } = parsed.success ? parsed.data : { page: 1, state: "unconfirmed" as const };
  const items = await prisma.notificationDelivery.findMany({ where: phoneOtpOperationsWhere(state), select: phoneOtpJobSelect, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (page - 1) * 50, take: 51 });
  const visible = items.slice(0, 50);
  const audits = visible.length ? await prisma.auditLog.findMany({ where: { action: "auth.phone_otp_claimed", entityType: "NotificationDelivery", entityId: { in: visible.map(item => item.id) } }, select: { entityId: true, metadata: true }, orderBy: { createdAt: "asc" }, take: 100 }) : [];
  const references = new Map<string, string>();
  for (const entry of audits) {
    const metadata = entry.metadata;
    if (entry.entityId && metadata && typeof metadata === "object" && !Array.isArray(metadata) && typeof metadata.clientReference === "string" && /^[a-f0-9]{20}$/.test(metadata.clientReference)) references.set(entry.entityId, metadata.clientReference);
  }
  const acknowledgements = visible.length ? await prisma.auditLog.findMany({ where: { action: PHONE_OTP_REVIEW_ACTION, entityType: "NotificationDelivery", entityId: { in: visible.map(item => item.id) } }, select: { entityId: true, createdAt: true, actor: { select: { fullName: true } } }, orderBy: { createdAt: "asc" }, take: 50 }) : [];
  const reviews = new Map(acknowledgements.filter(entry => entry.entityId).map(entry => [entry.entityId!, entry]));
  return <main className="dashboard-shell"><section className="admin-content sms-otp-operations">
    <p className="eyebrow">NOTIFICATION OPERATIONS</p><h1>SMS verification review.</h1>
    <p>Track requests without exposing phone numbers or codes. Acceptance does not confirm handset delivery.</p>
    <p><Link href="/admin/notifications">← Notification controls</Link> · <Link href="/admin/launch-readiness">Live setup checklist</Link> · <Link href="/admin/system-maintenance">Expired payload cleanup</Link></p>
    <details className="sms-otp-instructions"><summary>Review steps and send safety</summary><ol><li>Open the controlled messaging account and search the client reference below.</li><li>Compare its send reference and status with the provider evidence. Escalate missing or conflicting evidence to the deployment operator.</li><li>Do not resend or reset an attempt. If the customer needs another code, use a new verification request after the resend cooldown.</li></ol><p>You can acknowledge an investigation. Sending and delivery status stay unchanged; receipt handling and reconciliation approval remain required before launch.</p></details><p className="sms-otp-readiness"><strong>Live SMS is disabled.</strong> Complete the live setup checklist before enabling verification.</p>
    {!parsed.success ? <p role="alert">Invalid filter. Showing the first page of unconfirmed attempts.</p> : null}
    <form method="get" className="sms-otp-filter"><label htmlFor="sms-state">Show jobs</label><select id="sms-state" name="state" defaultValue={state}><option value="unconfirmed">Unconfirmed attempts</option><option value="queued">Queued</option><option value="accepted">Accepted</option><option value="cancelled">Cancelled before sending</option><option value="all">All jobs</option></select><button className="button secondary" type="submit">Apply filter</button></form>
    <div className="sms-otp-list">{visible.map(item => <article key={item.id}><h2>{phoneOtpJobLabel(item)}</h2><dl><dt>Job reference</dt><dd><code>{item.id}</code></dd><dt>Client reference</dt><dd><code>{references.get(item.id) ?? "No committed attempt reference"}</code></dd><dt>Send reference</dt><dd><code>{item.providerReference ?? "Acceptance not confirmed"}</code></dd><dt>Requested</dt><dd>{item.createdAt.toISOString()}</dd>{item.sentAt ? <><dt>Attempted</dt><dd>{item.sentAt.toISOString()}</dd></> : null}</dl>{reviews.has(item.id) ? <p className="sms-otp-acknowledged"><strong>Investigation acknowledged</strong><br />{reviews.get(item.id)?.actor?.fullName ?? "Former administrator"} · {reviews.get(item.id)?.createdAt.toISOString()}</p> : canAcknowledgePhoneOtpAttempt(item) ? <PhoneOtpInvestigation id={item.id} /> : null}</article>)}</div>
    {!visible.length ? <p className="empty-note" role="status">No SMS jobs match this filter. Production sending remains disabled until setup is certified.</p> : null}
    <nav className="sms-otp-pagination" aria-label="SMS job pages">{page > 1 ? <Link href={`?state=${state}&page=${page - 1}`}>← Previous page</Link> : null}<span>Page {page}</span>{items.length > 50 ? <Link href={`?state=${state}&page=${page + 1}`}>Next page →</Link> : null}</nav>
  </section></main>;
}
