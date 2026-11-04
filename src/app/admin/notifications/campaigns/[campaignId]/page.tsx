import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { getServerSession } from "@/lib/server-session";
import { CAMPAIGN_REPORT_PAGE_SIZE, campaignRecipientReportSelect, campaignRecipientSearchWhere, normalizeCampaignReportQuery } from "@/modules/notifications/campaign-report";

export const dynamic = "force-dynamic";

export default async function AdminCampaignReportPage({ params, searchParams }: { params: Promise<{ campaignId: string }>; searchParams: Promise<{ q?: string; page?: string }> }) {
  const [session, { campaignId }, queryParams] = await Promise.all([getServerSession(), params, searchParams]);
  if (!session?.roles.includes(ROLE.ADMIN) || session.portal !== "admin") redirect("/admin/login");
  const query = normalizeCampaignReportQuery(queryParams.q);
  const page = Math.max(1, Math.min(10_000, Number.parseInt(queryParams.page ?? "1", 10) || 1));
  const campaign = await prisma.marketingCampaign.findUnique({ where: { id: campaignId }, select: { id: true, campaignCode: true, title: true, body: true, titleBn: true, bodyBn: true, deepLink: true, status: true, audienceAccountType: true, audienceLocale: true, targetUserId: true, matchedConsentCount: true, frequencySuppressedCount: true, recipientCount: true, scheduledFor: true, sentAt: true, cancelledAt: true, failureCode: true, createdAt: true, createdBy: { select: { fullName: true, personCode: true } } } });
  if (!campaign) notFound();
  const where = { campaignId, ...campaignRecipientSearchWhere(query) };
  const [total, campaignTotal, readCount, recipients] = await prisma.$transaction([
    prisma.marketingCampaignRecipient.count({ where }),
    prisma.marketingCampaignRecipient.count({ where: { campaignId } }),
    prisma.marketingCampaignRecipient.count({ where: { campaignId, notification: { is: { readAt: { not: null } } } } }),
    prisma.marketingCampaignRecipient.findMany({ where, select: campaignRecipientReportSelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * CAMPAIGN_REPORT_PAGE_SIZE, take: CAMPAIGN_REPORT_PAGE_SIZE }),
  ]);
  const pages = Math.max(1, Math.ceil(total / CAMPAIGN_REPORT_PAGE_SIZE));
  const readRate = campaignTotal ? ((readCount / campaignTotal) * 100).toFixed(1) : "0.0";
  await prisma.auditLog.create({ data: { actorId: session.userId, action: "marketing.campaign_report_viewed", entityType: "MarketingCampaign", entityId: campaign.id, metadata: { queryUsed: Boolean(query), page } } });
  const statusTime = campaign.sentAt ? `Sent ${campaign.sentAt.toLocaleString()}` : campaign.cancelledAt ? `Cancelled ${campaign.cancelledAt.toLocaleString()}` : campaign.scheduledFor ? `Scheduled ${campaign.scheduledFor.toLocaleString()}` : `Created ${campaign.createdAt.toLocaleString()}`;

  return <main className="dashboard-shell"><section className="admin-content campaign-report">
    <Link className="back-to-orders" href="/admin/notifications">← Notification operations</Link>
    <div className="campaign-report-title"><div><p className="eyebrow">CAMPAIGN DELIVERY REPORT</p><h1>{campaign.title}</h1><p>{campaign.campaignCode} · created by {campaign.createdBy.fullName} ({campaign.createdBy.personCode}) · {statusTime}</p>{campaign.failureCode ? <p className="form-error">Delivery stopped safely: {campaign.failureCode}</p> : null}</div><span>In-app · {campaign.status}</span></div>
    <div className="campaign-report-stats">
      <article><span>Delivered</span><b>{campaign.recipientCount}</b></article>
      <article><span>{campaign.status === "SENT" ? "Opt-ins matched" : "Opt-ins at scheduling"}</span><b>{campaign.matchedConsentCount}</b></article>
      <article><span>Frequency suppressed</span><b>{campaign.frequencySuppressedCount}</b></article>
      <article><span>Read</span><b>{readCount}<small> · {readRate}%</small></b></article>
    </div>
    <section className="campaign-message-card"><div><h2>{campaign.status === "SENT" ? "Delivered content" : "Campaign content"}</h2><p>{campaign.body}</p>{campaign.titleBn || campaign.bodyBn ? <div lang="bn"><b>{campaign.titleBn}</b><p>{campaign.bodyBn}</p></div> : null}</div><dl><div><dt>Audience</dt><dd>{campaign.targetUserId ? "One selected customer" : `${campaign.audienceAccountType ?? "All account types"} · ${campaign.audienceLocale?.toUpperCase() ?? "All languages"}`}</dd></div><div><dt>Customer link</dt><dd>{campaign.deepLink ?? "No link"}</dd></div></dl></section>
    <form className="campaign-recipient-search" method="get"><label htmlFor="campaign-recipient-query">Find recipient</label><div><input defaultValue={query} id="campaign-recipient-query" maxLength={120} name="q" placeholder="Name, email, or customer ID"/><button className="button primary" type="submit">Search</button>{query ? <Link href={`/admin/notifications/campaigns/${campaign.id}`}>Clear</Link> : null}</div></form>
    <section className="wallet-transactions"><div className="updates-head"><div><h2>Recipient evidence</h2><p>{campaign.status === "SENT" ? "The preference timestamp is the consent snapshot captured when this campaign was delivered." : "Recipients are recorded only after consent is checked at delivery time."}</p></div><span>{total} recipient{total === 1 ? "" : "s"}</span></div>
      {recipients.length ? <div className="wallet-table-wrap"><table><thead><tr><th>Customer</th><th>Audience snapshot</th><th>Consent checked</th><th>Delivery</th><th>Read</th></tr></thead><tbody>{recipients.map((recipient) => { const delivery = recipient.notification.deliveries[0]; return <tr key={recipient.id}><td><Link href={`/admin/customers/${recipient.user.id}`}><b>{recipient.user.fullName}</b></Link><small>{recipient.user.personCode} · {recipient.user.email}</small></td><td>{recipient.accountTypeSnapshot} · {recipient.localeSnapshot.toUpperCase()}</td><td>{recipient.consentPreferenceUpdatedAt.toLocaleString()}</td><td><span className="status-active">{delivery?.status ?? "RECORDED"}</span><small>{delivery?.deliveredAt?.toLocaleString() ?? recipient.createdAt.toLocaleString()}</small></td><td>{recipient.notification.readAt ? <span className="status-active">READ</span> : <span className="status-inactive">UNREAD</span>}</td></tr>; })}</tbody></table></div> : <p className="empty-note">{campaign.status === "SCHEDULED" ? "This campaign is waiting for its delivery time." : "No recipient matches this search."}</p>}
    </section>
    {pages > 1 ? <nav className="campaign-pagination" aria-label="Campaign recipients"><span>Page {page} of {pages}</span><div>{page > 1 ? <Link href={`?${new URLSearchParams({ ...(query ? { q: query } : {}), page: String(page - 1) })}`}>Previous</Link> : null}{page < pages ? <Link href={`?${new URLSearchParams({ ...(query ? { q: query } : {}), page: String(page + 1) })}`}>Next</Link> : null}</div></nav> : null}
  </section></main>;
}
