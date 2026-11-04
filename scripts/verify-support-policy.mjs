import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";

const prisma = new PrismaClient();
const origin = new URL(process.env.TEST_BASE_URL ?? process.env.APP_BASE_URL ?? "http://localhost:3000").origin;
const authSecret = process.env.AUTH_SECRET;
if (!authSecret) throw new Error("AUTH_SECRET is required for support policy verification.");
const marker = randomBytes(8).toString("hex");
const ids = { users: [], sessions: [], tickets: [], shifts: [], holidays: [] };
const originalPolicy = await prisma.supportOperatingPolicy.findUnique({ where: { id: "default" } });
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function sessionFor(user, portal, mfaVerified = false) {
  const row = await prisma.authSession.create({ data: { userId: user.id, portal, clientName: "Support policy verification", clientType: "WEB", expiresAt: new Date(Date.now() + 3_600_000), mfaVerifiedAt: mfaVerified ? new Date() : null } });
  ids.sessions.push(row.id);
  return new SignJWT({ email: user.email, name: user.fullName, roles: [] }).setProtectedHeader({ alg: "HS256" }).setJti(row.id).setSubject(user.id).setIssuer(process.env.AUTH_ISSUER ?? "http://localhost:3000").setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(authSecret));
}

async function request(path, cookie, method = "GET", body, key) {
  const response = await fetch(`${origin}${path}`, { method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(method !== "GET" ? { Origin: origin } : {}), ...(cookie ? { Cookie: `crossly_session=${cookie}; __Host-crossly_session=${cookie}` } : {}), ...(key ? { "Idempotency-Key": key } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
  const contentType = response.headers.get("content-type") ?? "";
  return { response, body: contentType.includes("json") ? await response.json() : await response.text() };
}

function nextDhakaDate() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = (type) => Number(parts.find((part) => part.type === type).value);
  const date = new Date(Date.UTC(value("year"), value("month") - 1, value("day")));
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

async function queuedShiftRequests(payloads, cookie, beforeRelease = async () => {}, path = "/api/v1/admin/support-shifts", method = "POST") {
  let locked; let release;
  const ready = new Promise(resolve => { locked = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const holder = prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended('crossly:support-assignment', 0))");
    locked(); await gate; await beforeRelease(tx);
  }, { timeout: 15_000 });
  await ready;
  const pending = payloads.map(payload => request(path, cookie, method, payload));
  let queued = false;
  try {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const rows = await prisma.$queryRawUnsafe("SELECT count(*)::int AS waiting FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND classid = ((hashtextextended('crossly:support-assignment', 0) >> 32) & 4294967295)::oid AND objid = (hashtextextended('crossly:support-assignment', 0) & 4294967295)::oid");
      if (rows[0].waiting >= payloads.length) { queued = true; break; }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  } finally { release(); await holder; }
  const results = await Promise.all(pending);
  for (const result of results) if (result.response.status === 201) ids.shifts.push(result.body.data.shift.id);
  assert(queued, "Shift mutation did not wait for the support assignment/revocation lock.");
  return results;
}

try {
  const roles = {};
  for (const code of ["customer_personal", "customer_service", "admin"]) roles[code] = await prisma.role.upsert({ where: { code }, update: {}, create: { code, description: code } });
  async function user(label, role) { const row = await prisma.user.create({ data: { email: `${label}-${marker}@example.test`, fullName: `${label} ${marker}`, passwordHash: "not-used", status: "ACTIVE", roles: { create: { roleId: roles[role].id } } } }); ids.users.push(row.id); return row; }
  const admin = await user("policy-admin", "admin"); const agent = await user("policy-agent", "customer_service"); const customer = await user("policy-customer", "customer_personal");
  const [adminCookie, agentCookie, customerCookie] = await Promise.all([sessionFor(admin, "admin", true), sessionFor(agent, "support"), sessionFor(customer, "customer")]);
  const policyPayload = { timeZone: "Asia/Dhaka", firstResponseBusinessDays: 1, approachingHours: 6, businessWeekdays: [0, 1, 2, 3, 4, 5, 6], openingMinute: 540, closingMinute: 1020, requireScheduledShift: true, version: originalPolicy?.version ?? 1 };
  let policy;
  if (!originalPolicy) {
    let tableLocked; let releaseTable;
    const tableReady = new Promise(resolve => { tableLocked = resolve; });
    const tableGate = new Promise(resolve => { releaseTable = resolve; });
    const tableHolder = prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('LOCK TABLE "SupportOperatingPolicy" IN SHARE MODE');
      tableLocked(); await tableGate;
    }, { timeout: 15_000 });
    await tableReady;
    const pendingPolicies = [request("/api/v1/admin/support-policy", adminCookie, "PUT", policyPayload), request("/api/v1/admin/support-policy", adminCookie, "PUT", policyPayload)];
    let bothInserting = false;
    try {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const rows = await prisma.$queryRawUnsafe("SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%SupportOperatingPolicy%' AND query ILIKE '%INSERT%'");
        if (rows[0].waiting >= 2) { bothInserting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    } finally { releaseTable(); await tableHolder; }
    const initialized = await Promise.all(pendingPolicies);
    assert(bothInserting, "Concurrent policy initialization did not reach the insert barrier.");
    assert(initialized.filter(row => row.response.status === 200).length === 1 && initialized.filter(row => row.response.status === 409 && row.body.error.code === "SUPPORT_POLICY_CHANGED").length === 1, "Concurrent policy initialization must return one success and one conflict, without a server error.");
    policy = initialized.find(row => row.response.status === 200);
    assert(policy.body.data.policy.version === 2 && await prisma.supportOperatingPolicy.count() === 1 && await prisma.auditLog.count({ where: { actorId: admin.id, action: "support.operating_policy_changed" } }) === 1, "Initial policy version, singleton or audit cardinality failed.");
    const stale = await request("/api/v1/admin/support-policy", adminCookie, "PUT", policyPayload);
    assert(stale.response.status === 409 && await prisma.auditLog.count({ where: { actorId: admin.id, action: "support.operating_policy_changed" } }) === 1, "A stale default-version form overwrote the initialized policy.");
  } else policy = await request("/api/v1/admin/support-policy", adminCookie, "PUT", policyPayload);
  assert(policy.response.status === 200 && policy.body.data.policy.requireScheduledShift, `Support policy update failed: ${JSON.stringify(policy.body)}`);
  const savedVersion = policy.body.data.policy.version;
  const auditsBeforeSave = await prisma.auditLog.count({ where: { actorId: admin.id, action: "support.operating_policy_changed" } });
  const saves = await Promise.all([request("/api/v1/admin/support-policy", adminCookie, "PUT", { ...policyPayload, version: savedVersion }), request("/api/v1/admin/support-policy", adminCookie, "PUT", { ...policyPayload, version: savedVersion })]);
  assert(saves.filter(row => row.response.status === 200 && row.body.data.policy.version === savedVersion + 1).length === 1 && saves.filter(row => row.response.status === 409 && row.body.error.code === "SUPPORT_POLICY_CHANGED").length === 1, "Same-version policy saves did not preserve optimistic concurrency.");
  assert(await prisma.auditLog.count({ where: { actorId: admin.id, action: "support.operating_policy_changed" } }) === auditsBeforeSave + 1, "Concurrent policy saves duplicated their audit.");
  const holidayDate = nextDhakaDate();
  const holiday = await request("/api/v1/admin/support-holidays", adminCookie, "POST", { date: holidayDate, name: `Verification closure ${marker}` });
  assert(holiday.response.status === 201, `Support holiday creation failed: ${JSON.stringify(holiday.body)}`); ids.holidays.push(holiday.body.data.holiday.id);
  const ticketPayload = { category: "GENERAL", subject: "Support calendar verification", body: "Please verify the configured support calendar and rota rules.", attachmentReferences: [] };
  const unstaffed = await request("/api/v1/tickets", customerCookie, "POST", ticketPayload, `policy-ticket-unstaffed-${marker}`);
  assert(unstaffed.response.status === 201 && unstaffed.body.data.ticket.status === "OPEN", "A ticket was assigned outside a scheduled shift."); ids.tickets.push(unstaffed.body.data.ticket.id);
  const unstaffedRow = await prisma.ticket.findUniqueOrThrow({ where: { id: unstaffed.body.data.ticket.id } });
  assert(unstaffedRow.slaApproachingAt && unstaffedRow.slaDueAt.getTime() - unstaffedRow.slaApproachingAt.getTime() === 6 * 3_600_000, "The configured approaching threshold was not snapshotted.");
  const dueLocalDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit" }).format(unstaffedRow.slaDueAt);
  assert(dueLocalDate !== holidayDate, "The configured support holiday was counted as a business day.");
  const startsAt = new Date(Date.now() - 60 * 60 * 1000).toISOString(); const endsAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const shift = await request("/api/v1/admin/support-shifts", adminCookie, "POST", { agentId: agent.id, startsAt, endsAt, note: "Verification coverage" });
  assert(shift.response.status === 201, `Support shift creation failed: ${JSON.stringify(shift.body)}`); ids.shifts.push(shift.body.data.shift.id);
  const overlap = await request("/api/v1/admin/support-shifts", adminCookie, "POST", { agentId: agent.id, startsAt, endsAt, note: "Overlap must fail" });
  assert(overlap.response.status === 409 && overlap.body.error.code === "SUPPORT_SHIFT_OVERLAP", "An overlapping shift was accepted.");
  const staffed = await request("/api/v1/tickets", customerCookie, "POST", { ...ticketPayload, subject: "Scheduled support assignment verification" }, `policy-ticket-staffed-${marker}`);
  assert(staffed.response.status === 201 && staffed.body.data.ticket.status === "ASSIGNED", "A scheduled available agent did not receive a ticket."); ids.tickets.push(staffed.body.data.ticket.id);
  const assignedRow = await prisma.ticket.findUniqueOrThrow({ where: { id: staffed.body.data.ticket.id } });
  assert(assignedRow.assignedAgentId === agent.id, "The ticket was assigned to the wrong scheduled agent.");
  const cancel = await request(`/api/v1/admin/support-shifts/${shift.body.data.shift.id}`, adminCookie, "DELETE");
  assert(cancel.response.status === 200 && cancel.body.data.shift.status === "CANCELLED", "Support shift cancellation failed.");
  const racePayload = { agentId: agent.id, startsAt: "2061-01-01T09:00:00.000Z", endsAt: "2061-01-01T17:00:00.000Z", note: "Synthetic concurrent shift" };
  const concurrent = await queuedShiftRequests([racePayload, racePayload], adminCookie);
  assert(concurrent.filter(row => row.response.status === 201).length === 1 && concurrent.filter(row => row.response.status === 409 && row.body.error.code === "SUPPORT_SHIFT_OVERLAP").length === 1, "Concurrent overlapping shifts were not serialized into one creation and one conflict.");
  const created = concurrent.find(row => row.response.status === 201).body.data.shift;
  assert(await prisma.supportShift.count({ where: { agentId: agent.id, status: "SCHEDULED", startsAt: new Date(racePayload.startsAt) } }) === 1, "Concurrent requests created duplicate scheduled shifts.");
  assert(await prisma.auditLog.count({ where: { entityId: created.id, action: "support.shift_created" } }) === 1, "Concurrent creation did not preserve a single shift audit.");
  const adjacent = await request("/api/v1/admin/support-shifts", adminCookie, "POST", { ...racePayload, startsAt: racePayload.endsAt, endsAt: "2061-01-01T18:00:00.000Z" });
  assert(adjacent.response.status === 201, "Non-overlapping adjacent shifts should be allowed."); ids.shifts.push(adjacent.body.data.shift.id);
  const cancellations = await queuedShiftRequests([undefined, undefined], adminCookie, undefined, `/api/v1/admin/support-shifts/${created.id}`, "DELETE");
  assert(cancellations.every(row => row.response.status === 200 && row.body.data.shift.status === "CANCELLED"), "Concurrent cancellation did not confirm the cancelled shift.");
  assert(cancellations.filter(row => row.body.data.idempotentReplay === false).length === 1 && cancellations.filter(row => row.body.data.idempotentReplay === true).length === 1, "Cancellation must commit once and return one idempotent replay.");
  assert(await prisma.auditLog.count({ where: { entityId: created.id, action: "support.shift_cancelled" } }) === 1, "Concurrent cancellation duplicated the audit.");
  const replay = await request(`/api/v1/admin/support-shifts/${created.id}`, adminCookie, "DELETE");
  assert(replay.response.status === 200 && replay.body.data.idempotentReplay === true && await prisma.auditLog.count({ where: { entityId: created.id, action: "support.shift_cancelled" } }) === 1, "Later cancellation retry changed audit history.");
  const revokedAgent = await user("policy-revoked-agent", "customer_service");
  const denied = await queuedShiftRequests([{ ...racePayload, agentId: revokedAgent.id }], adminCookie, tx => tx.userRole.delete({ where: { userId_roleId: { userId: revokedAgent.id, roleId: roles.customer_service.id } } }));
  assert(denied[0].response.status === 404 && denied[0].body.error.code === "SUPPORT_AGENT_NOT_FOUND", "Shift creation used stale eligibility after support-role removal.");
  assert(await prisma.supportShift.count({ where: { agentId: revokedAgent.id } }) === 0, "Role removal race created an ineligible shift.");
  const afterCancel = await request("/api/v1/tickets", customerCookie, "POST", { ...ticketPayload, subject: "Cancelled shift assignment verification" }, `policy-ticket-cancelled-${marker}`);
  assert(afterCancel.response.status === 201 && afterCancel.body.data.ticket.status === "OPEN", "A cancelled shift remained eligible for assignment."); ids.tickets.push(afterCancel.body.data.ticket.id);
  const settingsPage = await request("/admin/support/settings", adminCookie);
  assert(settingsPage.response.status === 200 && settingsPage.body.includes("SUPPORT POLICY"), "Admin support settings page failed.");
  const agentQueue = await request("/support/tickets", agentCookie);
  assert(agentQueue.response.status === 200, "Customer Service queue failed under shift-gated policy.");
  const holidayId = holiday.body.data.holiday.id;
  let rowLocked; let releaseRow;
  const rowReady = new Promise(resolve => { rowLocked = resolve; });
  const rowGate = new Promise(resolve => { releaseRow = resolve; });
  const rowHolder = prisma.$transaction(async tx => {
    await tx.$queryRawUnsafe('SELECT id FROM "SupportHoliday" WHERE id = $1 FOR UPDATE', holidayId);
    rowLocked(); await rowGate;
  }, { timeout: 15_000 });
  await rowReady;
  const removals = [request(`/api/v1/admin/support-holidays/${holidayId}`, adminCookie, "DELETE"), request(`/api/v1/admin/support-holidays/${holidayId}`, adminCookie, "DELETE")];
  let bothWaiting = false;
  try {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const rows = await prisma.$queryRawUnsafe("SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%SupportHoliday%' AND query ILIKE '%DELETE%'");
      if (rows[0].waiting >= 2) { bothWaiting = true; break; }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  } finally { releaseRow(); await rowHolder; }
  const removed = await Promise.all(removals);
  assert(bothWaiting, "Concurrent holiday removals did not reach the row-lock barrier.");
  assert(removed.filter(row => row.response.status === 200 && row.body.data.removed === true).length === 1 && removed.filter(row => row.response.status === 404 && row.body.error.code === "SUPPORT_HOLIDAY_NOT_FOUND").length === 1, "Concurrent holiday removal must return one success and one not-found response, without a server error.");
  assert(await prisma.supportHoliday.count({ where: { id: holidayId } }) === 0 && await prisma.auditLog.count({ where: { entityId: holidayId, action: "support.holiday_removed" } }) === 1, "Concurrent holiday removal changed audit cardinality or left the date active.");
  const removalReplay = await request(`/api/v1/admin/support-holidays/${holidayId}`, adminCookie, "DELETE");
  assert(removalReplay.response.status === 404 && await prisma.auditLog.count({ where: { entityId: holidayId, action: "support.holiday_removed" } }) === 1, "Holiday removal retry changed its not-found contract or audit history."); ids.holidays = [];
  console.log("Support policy verification passed: first-time initialization and same-version save races, calendar/SLA, assignment, shift creation/cancellation races, role removal, holiday removal/retry, audit cardinality and web pages.");
} finally {
  if (ids.tickets.length) {
    await prisma.notification.deleteMany({ where: { userId: { in: ids.users } } });
    const conversations = await prisma.conversation.findMany({ where: { ticketId: { in: ids.tickets } }, select: { id: true } });
    await prisma.conversationMessage.deleteMany({ where: { conversationId: { in: conversations.map((row) => row.id) } } });
    await prisma.ticketEvent.deleteMany({ where: { ticketId: { in: ids.tickets } } });
    await prisma.conversation.deleteMany({ where: { ticketId: { in: ids.tickets } } });
    await prisma.ticket.deleteMany({ where: { id: { in: ids.tickets } } });
  }
  if (ids.shifts.length) await prisma.supportShift.deleteMany({ where: { id: { in: ids.shifts } } });
  if (ids.holidays.length) await prisma.supportHoliday.deleteMany({ where: { id: { in: ids.holidays } } });
  if (originalPolicy) await prisma.supportOperatingPolicy.update({ where: { id: "default" }, data: { timeZone: originalPolicy.timeZone, firstResponseBusinessDays: originalPolicy.firstResponseBusinessDays, approachingHours: originalPolicy.approachingHours, businessWeekdays: originalPolicy.businessWeekdays, openingMinute: originalPolicy.openingMinute, closingMinute: originalPolicy.closingMinute, requireScheduledShift: originalPolicy.requireScheduledShift, version: originalPolicy.version, updatedById: originalPolicy.updatedById } });
  else await prisma.supportOperatingPolicy.deleteMany({ where: { id: "default" } });
  if (ids.sessions.length) await prisma.authSession.deleteMany({ where: { id: { in: ids.sessions } } });
  if (ids.users.length) { await prisma.auditLog.deleteMany({ where: { actorId: { in: ids.users } } }); await prisma.userRole.deleteMany({ where: { userId: { in: ids.users } } }); await prisma.user.deleteMany({ where: { id: { in: ids.users } } }); }
  await prisma.$disconnect();
}
