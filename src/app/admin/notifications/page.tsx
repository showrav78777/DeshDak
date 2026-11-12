import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminMarketingCampaignForm } from "@/components/admin-marketing-campaign-form";
import { CancelCampaignButton, RunDueCampaignsButton } from "@/components/admin-marketing-campaign-controls";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { getServerSession } from "@/lib/server-session";

export const dynamic = "force-dynamic";

export default async function AdminNotificationsPage() {
  const session = await getServerSession();
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") redirect("/admin/login");
  const [queuedEmail, acceptedEmail, confirmedEmail, blockedEmail, pendingReceipts, failed, deliveredInApp, recent, campaigns, optedInCustomers] = await Promise.all([
    prisma.notificationDelivery.count({ where: { channel: "EMAIL", status: "QUEUED" } }),
    prisma.notificationDelivery.count({ where: { channel: "EMAIL", status: "SENT", providerReference: { not: null } } }),
    prisma.notificationDelivery.count({ where: { channel: "EMAIL", status: { in: ["DELIVERED", "READ"] }, providerEventType: "email.delivered" } }),
    prisma.emailSuppression.count({ where: { active: true } }),
    prisma.emailWebhookEvent.count({ where: { processedAt: null } }),
    prisma.notificationDelivery.count({ where: { status: "FAILED" } }),
    prisma.notificationDelivery.count({ where: { channel: "IN_APP", status: { in: ["DELIVERED", "READ"] } } }),
    prisma.notificationDelivery.findMany({ include: { notification: { select: { eventType: true, title: true, priority: true, createdAt: true, user: { select: { fullName: true, email: true } } } } }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.marketingCampaign.findMany({ select: { id: true, campaignCode: true, title: true, status: true, audienceAccountType: true, audienceLocale: true, targetUserId: true, matchedConsentCount: true, frequencySuppressedCount: true, recipientCount: true, scheduledFor: true, sentAt: true, failureCode: true, createdAt: true, createdBy: { select: { fullName: true } } }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.user.findMany({ where: { status: "ACTIVE", deletedAt: null, notificationPreferences: { some: { category: "MARKETING", channel: "IN_APP", enabled: true } }, roles: { some: { role: { code: { in: [ROLE.CUSTOMER_PERSONAL, "customer_business"] } } } } }, select: { id: true, personCode: true, fullName: true, email: true, locale: true, accountType: true }, orderBy: { fullName: "asc" }, take: 500 }),
  ]);

  return <main className="dashboard-shell"><section className="admin-content admin-notification-operations">
    <p className="eyebrow">NOTIFICATION OPERATIONS</p><h1>Delivery and campaigns.</h1>
    <p className="admin-intro">Monitor transactional delivery and send or schedule controlled in-app promotions only to customers who explicitly opted in. External channels remain unavailable until approved providers are connected.</p>
    <div className="admin-hub-grid">
      <article className="admin-hub-card"><span>♢</span><div><h2>In-app delivered</h2><p>Delivered or read by customers.</p></div><b>{deliveredInApp}</b></article>
      <article className="admin-hub-card"><span>✉</span><div><h2>Email queued</h2><p>Waiting for provider setup, a worker run or retry time.</p></div><b>{queuedEmail}</b></article>
      <article className="admin-hub-card"><span>↗</span><div><h2>Email accepted</h2><p>Provider accepted; recipient delivery is unconfirmed.</p></div><b>{acceptedEmail}</b></article>
      <article className="admin-hub-card"><span>✓</span><div><h2>Receipt-confirmed email</h2><p>Signed receipt confirms recipient-server delivery, not reading.</p></div><b>{confirmedEmail}</b></article>
      <article className="admin-hub-card"><span>!</span><div><h2>Failed delivery</h2><p>Requires provider or worker attention.</p></div><b>{failed}</b></article>
    </div>
    <p><Link className="button secondary" href="/admin/notifications/sms">Review SMS verification jobs</Link></p>
    <p><Link className="button secondary" href="/admin/notifications/email-suppressions">Review blocked email addresses ({blockedEmail}) →</Link></p>
    {pendingReceipts ? <p className="form-help">{pendingReceipts} signed receipt(s) await a matching send record or legacy recipient evidence. Check worker/provider evidence; never infer delivery from an unmatched receipt.</p> : null}
    <AdminMarketingCampaignForm customers={optedInCustomers} />
    <section className="marketing-history"><div className="updates-head"><div><h2>Marketing campaign history</h2><p>Open a campaign to inspect its recipient and consent evidence.</p></div><div><span>{campaigns.length} recent</span><RunDueCampaignsButton /></div></div>
      {campaigns.length ? <div className="marketing-history-list">{campaigns.map((campaign) => <article key={campaign.id}>
        <div><Link href={`/admin/notifications/campaigns/${campaign.id}`}><b>{campaign.title}</b></Link><small>{campaign.campaignCode} · created by {campaign.createdBy.fullName}</small><strong className={`campaign-state campaign-state-${campaign.status.toLowerCase()}`}>{campaign.status}</strong></div>
        <span>{campaign.targetUserId ? "Single customer" : `${campaign.audienceAccountType ?? "All accounts"} · ${campaign.audienceLocale?.toUpperCase() ?? "All languages"}`}</span>
        <dl><div><dt>Delivered</dt><dd>{campaign.recipientCount}</dd></div><div><dt>Opt-ins matched</dt><dd>{campaign.matchedConsentCount}</dd></div><div><dt>Suppressed</dt><dd>{campaign.frequencySuppressedCount}</dd></div></dl>
        <div><time dateTime={(campaign.sentAt ?? campaign.scheduledFor ?? campaign.createdAt).toISOString()}>{campaign.sentAt ? `Sent ${campaign.sentAt.toLocaleString()}` : campaign.scheduledFor ? `Scheduled ${campaign.scheduledFor.toLocaleString()}` : campaign.createdAt.toLocaleString()}</time>{campaign.failureCode ? <small>{campaign.failureCode}</small> : null}<Link className="campaign-report-link" href={`/admin/notifications/campaigns/${campaign.id}`}>View report →</Link>{campaign.status === "SCHEDULED" ? <CancelCampaignButton campaignId={campaign.id} /> : null}</div>
      </article>)}</div> : <p className="empty-note">No marketing campaign has been sent.</p>}
    </section>
    <section className="wallet-transactions"><div className="updates-head"><div><h2>Recent delivery log</h2><p>Customer content is shown; internal provider errors remain server-side.</p></div><span>{recent.length} record{recent.length === 1 ? "" : "s"}</span></div>
      {recent.length ? <div className="wallet-table-wrap"><table><thead><tr><th>Created</th><th>Customer</th><th>Event</th><th>Channel</th><th>Status</th></tr></thead><tbody>{recent.map((delivery) => <tr key={delivery.id}><td>{delivery.createdAt.toLocaleString()}</td><td><b>{delivery.notification.user.fullName}</b><small>{delivery.notification.user.email}</small></td><td><b>{delivery.notification.title}</b><small>{delivery.notification.eventType}</small></td><td>{delivery.channel}</td><td><span className={delivery.status === "FAILED" ? "status-inactive" : "status-active"}>{delivery.channel === "EMAIL" && delivery.status === "SENT" ? delivery.providerReference ? "Accepted; delivery unconfirmed" : "Sending / awaiting acceptance" : delivery.status}</span></td></tr>)}</tbody></table></div> : <div className="dashboard-card"><h2>No deliveries yet</h2><p>Order and payment events will create delivery records here.</p></div>}
    </section>
  </section></main>;
}
