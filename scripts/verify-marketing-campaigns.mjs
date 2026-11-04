import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";

const prisma = new PrismaClient();
const origin = new URL(process.env.TEST_BASE_URL ?? process.env.APP_BASE_URL ?? "http://localhost:3000").origin;
const authSecret = process.env.AUTH_SECRET;
if (!authSecret) throw new Error("AUTH_SECRET is required for marketing-campaign verification.");
const marker = randomBytes(8).toString("hex");
const ids = { users: [], sessions: [], campaigns: [], notifications: [], maintenanceRuns: [] };

async function tokenFor(user, roles, portal, mfa = false) {
  const session = await prisma.authSession.create({ data: { userId: user.id, portal, clientName: "Marketing campaign verification", clientType: "WEB", expiresAt: new Date(Date.now() + 3_600_000), mfaVerifiedAt: mfa ? new Date() : null } }); ids.sessions.push(session.id);
  return new SignJWT({ email: user.email, name: user.fullName, roles }).setProtectedHeader({ alg: "HS256" }).setJti(session.id).setSubject(user.id).setIssuer(process.env.AUTH_ISSUER ?? "http://localhost:3000").setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(authSecret));
}

async function request(path, token, method = "GET", body, key, trusted = true) {
  const response = await fetch(`${origin}${path}`, { method, headers: { ...(token ? { Cookie: `crossly_session=${token}; __Host-crossly_session=${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...(key ? { "Idempotency-Key": key } : {}), ...(trusted && method !== "GET" ? { Origin: origin } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
  const text = await response.text();
  return { response, text, body: response.headers.get("content-type")?.includes("json") ? JSON.parse(text) : null };
}

try {
  const [adminRole, customerRole] = await Promise.all([prisma.role.upsert({ where: { code: "admin" }, update: {}, create: { code: "admin", description: "Platform administrator" } }), prisma.role.upsert({ where: { code: "customer_personal" }, update: {}, create: { code: "customer_personal", description: "Personal customer" } })]);
  const createUser = async (label, roleId, locale = "en", accountType = "PERSONAL") => { const user = await prisma.user.create({ data: { email: `${label}-${marker}@example.test`, fullName: `${label} ${marker}`, passwordHash: "not-used", status: "ACTIVE", locale, accountType, roles: { create: { roleId } } } }); ids.users.push(user.id); return user; };
  const admin = await createUser("marketing-admin", adminRole.id);
  const english = await createUser("marketing-english", customerRole.id, "en", "PERSONAL");
  const bangla = await createUser("marketing-bangla", customerRole.id, "bn", "BUSINESS");
  const noConsent = await createUser("marketing-no-consent", customerRole.id);
  await prisma.notificationPreference.createMany({ data: [{ userId: english.id, category: "MARKETING", channel: "IN_APP", enabled: true, locale: "en" }, { userId: bangla.id, category: "MARKETING", channel: "IN_APP", enabled: true, locale: "bn" }, { userId: noConsent.id, category: "MARKETING", channel: "IN_APP", enabled: false, locale: "en" }] });
  const [adminToken, englishToken, banglaToken] = await Promise.all([tokenFor(admin, ["admin"], "admin", true), tokenFor(english, ["customer_personal"], "customer"), tokenFor(bangla, ["customer_personal"], "customer")]);
  assert.equal((await request("/api/v1/admin/marketing-campaigns")).response.status, 403, "Anonymous campaign preview was not denied.");
  assert.equal((await request("/api/v1/admin/marketing-campaigns", englishToken)).response.status, 403, "Customer accessed the campaign preview.");
  const preview = await request("/api/v1/admin/marketing-campaigns", adminToken);
  assert.equal(preview.response.status, 200); assert.equal(preview.body.data.preview.matchedConsentCount, 2); assert.equal(preview.body.data.preview.eligibleCount, 2);
  const payload = { title: `Verified offer ${marker}`, body: "A controlled promotional message for opted-in customers.", titleBn: `যাচাইকৃত অফার ${marker}`, bodyBn: "সম্মত গ্রাহকদের জন্য একটি নিয়ন্ত্রিত প্রচার বার্তা।", deepLink: "/products", locale: "en" };
  const key = `marketing-${marker}-english`;
  assert.equal((await request("/api/v1/admin/marketing-campaigns", adminToken, "POST", payload, key, false)).response.status, 403, "Campaign mutation accepted an untrusted origin.");
  const invalidLink = await request("/api/v1/admin/marketing-campaigns", adminToken, "POST", { ...payload, deepLink: "/admin/customers" }, `marketing-${marker}-invalid`);
  assert.equal(invalidLink.response.status, 422, "Private Admin link was accepted as marketing content.");
  const sent = await request("/api/v1/admin/marketing-campaigns", adminToken, "POST", payload, key);
  assert.equal(sent.response.status, 201, `Campaign send failed: ${sent.text}`); ids.campaigns.push(sent.body.data.campaign.id);
  assert.equal(sent.body.data.campaign.recipientCount, 1, "Locale audience was not enforced.");
  const replay = await request("/api/v1/admin/marketing-campaigns", adminToken, "POST", payload, key);
  assert.equal(replay.response.status, 200); assert.equal(replay.body.data.idempotentReplay, true);
  const mismatch = await request("/api/v1/admin/marketing-campaigns", adminToken, "POST", { ...payload, title: "Changed title" }, key);
  assert.equal(mismatch.response.status, 409); assert.equal(mismatch.body.error.code, "IDEMPOTENCY_KEY_REUSED");
  const recipients = await prisma.marketingCampaignRecipient.findMany({ where: { campaignId: sent.body.data.campaign.id }, include: { notification: { include: { deliveries: true } } } });
  ids.notifications.push(...recipients.map((item) => item.notificationId));
  assert.equal(recipients.length, 1); assert.equal(recipients[0].userId, english.id); assert(recipients[0].consentPreferenceId && recipients[0].consentPreferenceUpdatedAt);
  assert.equal(recipients[0].notification.category, "MARKETING"); assert.equal(recipients[0].notification.deliveries[0].status, "DELIVERED"); assert.equal(recipients[0].notification.deliveries[0].channel, "IN_APP");
  const reportPath = `/api/v1/admin/marketing-campaigns/${sent.body.data.campaign.id}`;
  assert.equal((await request(reportPath)).response.status, 403, "Anonymous user accessed a campaign report.");
  assert.equal((await request(reportPath, englishToken)).response.status, 403, "Customer accessed a campaign report.");
  const report = await request(reportPath, adminToken);
  assert.equal(report.response.status, 200, `Campaign report failed: ${report.text}`);
  assert.equal(report.body.data.campaign.campaignCode, sent.body.data.campaign.campaignCode); assert.equal(report.body.data.recipients.length, 1);
  assert.equal(report.body.data.recipients[0].user.id, english.id); assert(report.body.data.recipients[0].consentPreferenceUpdatedAt);
  assert.deepEqual(report.body.data.metrics, { recipientCount: 1, readCount: 0, unreadCount: 1, readRatePercent: 0 }, "Initial campaign read metrics are incorrect.");
  const searchedReport = await request(`${reportPath}?q=${encodeURIComponent(english.personCode)}`, adminToken);
  assert.equal(searchedReport.body.data.pagination.total, 1, "Recipient search did not match the customer ID.");
  const emptyReport = await request(`${reportPath}?q=no-such-recipient`, adminToken);
  assert.equal(emptyReport.body.data.pagination.total, 0, "Recipient search returned an unrelated customer.");
  assert.equal((await request("/api/v1/admin/marketing-campaigns/not-a-uuid", adminToken)).response.status, 422, "Invalid campaign ID did not fail validation.");
  assert.equal((await request(`/api/v1/notifications/${recipients[0].notificationId}/read`, englishToken, "PATCH")).response.status, 200, "Recipient could not mark the campaign notification read.");
  const readReport = await request(reportPath, adminToken);
  assert(readReport.body.data.recipients[0].notification.readAt, "Campaign report did not expose the read state.");
  assert.deepEqual(readReport.body.data.metrics, { recipientCount: 1, readCount: 1, unreadCount: 0, readRatePercent: 100 }, "Campaign-wide read metrics did not update.");
  const filteredAfterRead = await request(`${reportPath}?q=no-such-recipient`, adminToken);
  assert.equal(filteredAfterRead.body.data.pagination.total, 0); assert.equal(filteredAfterRead.body.data.metrics.readCount, 1, "Recipient search incorrectly changed campaign-wide metrics.");
  assert.equal(await prisma.notification.count({ where: { userId: noConsent.id, category: "MARKETING" } }), 0, "A customer without opt-in received marketing.");
  const frequency = await request("/api/v1/admin/marketing-campaigns", adminToken);
  assert.equal(frequency.body.data.preview.matchedConsentCount, 2); assert.equal(frequency.body.data.preview.eligibleCount, 1); assert.equal(frequency.body.data.preview.frequencySuppressedCount, 1);
  const customerPage = await request("/notifications", englishToken); assert(customerPage.text.includes(payload.title), "Recipient notification center omitted the campaign.");
  const otherPage = await request("/notifications", banglaToken); assert(!otherPage.text.includes(payload.title), "A customer outside the locale audience received the campaign.");
  const scheduledPayload = { ...payload, title: `Scheduled offer ${marker}`, body: "A scheduled promotion whose consent is checked at delivery time.", titleBn: `নির্ধারিত অফার ${marker}`, locale: "bn", scheduledFor: new Date(Date.now() + 10 * 60_000).toISOString() };
  assert.equal((await request("/api/v1/admin/marketing-campaigns", adminToken, "POST", { ...scheduledPayload, scheduledFor: new Date(Date.now() + 60_000).toISOString() }, `marketing-${marker}-too-soon`)).response.status, 422, "Unsafe near-immediate schedule time was accepted.");
  const scheduledToCancel = await request("/api/v1/admin/marketing-campaigns", adminToken, "POST", scheduledPayload, `marketing-${marker}-cancel`);
  assert.equal(scheduledToCancel.response.status, 201, `Campaign schedule failed: ${scheduledToCancel.text}`); ids.campaigns.push(scheduledToCancel.body.data.campaign.id);
  assert.equal(scheduledToCancel.body.data.campaign.status, "SCHEDULED"); assert.equal(scheduledToCancel.body.data.campaign.recipientCount, 0);
  assert.equal(await prisma.notification.count({ where: { entityId: scheduledToCancel.body.data.campaign.id } }), 0, "A scheduled campaign delivered before its due time.");
  assert.equal((await request(`/api/v1/admin/marketing-campaigns/${scheduledToCancel.body.data.campaign.id}`, adminToken, "PATCH", { action: "CANCEL" }, undefined, false)).response.status, 403, "Campaign cancellation accepted an untrusted origin.");
  const cancelled = await request(`/api/v1/admin/marketing-campaigns/${scheduledToCancel.body.data.campaign.id}`, adminToken, "PATCH", { action: "CANCEL" });
  assert.equal(cancelled.response.status, 200); assert.equal(cancelled.body.data.campaign.status, "CANCELLED");
  assert.equal((await request(`/api/v1/admin/marketing-campaigns/${scheduledToCancel.body.data.campaign.id}`, adminToken, "PATCH", { action: "CANCEL" })).response.status, 409, "Cancelled campaign was cancelled twice.");
  const scheduled = await request("/api/v1/admin/marketing-campaigns", adminToken, "POST", { ...scheduledPayload, title: `Due offer ${marker}` }, `marketing-${marker}-due`);
  assert.equal(scheduled.response.status, 201); ids.campaigns.push(scheduled.body.data.campaign.id);
  await prisma.marketingCampaign.update({ where: { id: scheduled.body.data.campaign.id }, data: { scheduledFor: new Date(Date.now() - 60_000) } });
  const run = await request("/api/v1/admin/marketing-campaigns/run", adminToken, "POST");
  assert.equal(run.response.status, 200, `Due campaign run failed: ${run.text}`); ids.maintenanceRuns.push(run.body.data.runId);
  assert.equal(run.body.data.summary.sent, 1); assert.equal(run.body.data.summary.recipients, 1);
  const deliveredScheduled = await prisma.marketingCampaign.findUniqueOrThrow({ where: { id: scheduled.body.data.campaign.id }, include: { recipients: { include: { notification: true } } } });
  assert.equal(deliveredScheduled.status, "SENT"); assert(deliveredScheduled.sentAt); assert.equal(deliveredScheduled.recipients[0].userId, bangla.id);
  ids.notifications.push(...deliveredScheduled.recipients.map((recipient) => recipient.notificationId));
  assert((await request("/notifications", banglaToken)).text.includes(scheduledPayload.titleBn), "Scheduled campaign was not visible in the customer's profile language.");
  const adminPage = await request("/admin/notifications", adminToken); assert(adminPage.text.includes("Send or schedule a promotion") && adminPage.text.includes(sent.body.data.campaign.campaignCode), "Admin campaign compose/history page did not render.");
  const reportPage = await request(`/admin/notifications/campaigns/${sent.body.data.campaign.id}`, adminToken); assert(reportPage.text.includes("CAMPAIGN DELIVERY REPORT") && reportPage.text.includes(english.personCode), "Protected campaign report page did not render recipient evidence.");
  assert.equal(await prisma.auditLog.count({ where: { actorId: admin.id, action: "marketing.campaign_sent", entityId: sent.body.data.campaign.id } }), 1, "Campaign audit evidence is missing or duplicated.");
  assert(await prisma.auditLog.count({ where: { actorId: admin.id, action: "marketing.campaign_report_viewed", entityId: sent.body.data.campaign.id } }), "Campaign report access audit evidence is missing.");
  console.log("Marketing-campaign verification passed: Admin/MFA boundary, explicit opt-in, immediate and scheduled delivery, cancellation, delivery-time consent, bounded Admin execution, localization, frequency suppression, recipient snapshots, delivery/read records, searchable reporting, audit evidence, and protected rendering.");
} finally {
  if (ids.campaigns.length) await prisma.marketingCampaignRecipient.deleteMany({ where: { campaignId: { in: ids.campaigns } } });
  if (ids.notifications.length) await prisma.notification.deleteMany({ where: { id: { in: ids.notifications } } });
  if (ids.campaigns.length) { await prisma.auditLog.deleteMany({ where: { entityType: "MarketingCampaign", entityId: { in: ids.campaigns } } }); await prisma.marketingCampaign.deleteMany({ where: { id: { in: ids.campaigns } } }); }
  if (ids.maintenanceRuns.length) await prisma.maintenanceJobRun.deleteMany({ where: { id: { in: ids.maintenanceRuns } } });
  await prisma.maintenanceJobState.deleteMany({ where: { jobKey: "marketing_campaign_delivery" } });
  if (ids.users.length) { await prisma.notificationPreference.deleteMany({ where: { userId: { in: ids.users } } }); await prisma.auditLog.deleteMany({ where: { actorId: { in: ids.users } } }); }
  if (ids.sessions.length) await prisma.authSession.deleteMany({ where: { id: { in: ids.sessions } } });
  if (ids.users.length) { await prisma.userRole.deleteMany({ where: { userId: { in: ids.users } } }); await prisma.user.deleteMany({ where: { id: { in: ids.users } } }); }
  await prisma.$disconnect();
}
