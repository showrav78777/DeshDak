import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";

const prisma = new PrismaClient();
const origin = new URL(process.env.TEST_BASE_URL ?? process.env.APP_BASE_URL ?? "http://localhost:3000").origin;
const authSecret = process.env.AUTH_SECRET;
if (!authSecret) throw new Error("AUTH_SECRET is required for support verification.");
const marker = randomBytes(8).toString("hex");
const ids = { users: [], sessions: [], tickets: [] };
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function sessionFor(user, portal, mfaVerified = false) {
  const row = await prisma.authSession.create({ data: { userId: user.id, portal, clientName: "Support verification", clientType: "WEB", expiresAt: new Date(Date.now() + 3_600_000), mfaVerifiedAt: mfaVerified ? new Date() : null } });
  ids.sessions.push(row.id);
  return new SignJWT({ email: user.email, name: user.fullName, roles: [] }).setProtectedHeader({ alg: "HS256" }).setJti(row.id).setSubject(user.id).setIssuer(process.env.AUTH_ISSUER ?? "http://localhost:3000").setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(authSecret));
}

async function request(path, cookie, method = "GET", body, idempotencyKey, includeOrigin = true) {
  const response = await fetch(`${origin}${path}`, { method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(includeOrigin && method !== "GET" ? { Origin: origin } : {}), ...(cookie ? { Cookie: `crossly_session=${cookie}; __Host-crossly_session=${cookie}` } : {}), ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
  const contentType = response.headers.get("content-type") ?? "";
  return { response, body: contentType.includes("json") ? await response.json() : await response.text() };
}

try {
  const roles = {};
  for (const code of ["customer_personal", "customer_service", "admin"]) roles[code] = await prisma.role.upsert({ where: { code }, update: {}, create: { code, description: code } });
  async function user(label, role) { const row = await prisma.user.create({ data: { email: `${label}-${marker}@example.test`, fullName: `${label} ${marker}`, passwordHash: "not-used", status: "ACTIVE", roles: { create: { roleId: roles[role].id } } } }); ids.users.push(row.id); return row; }
  const customer = await user("support-customer", "customer_personal");
  const otherCustomer = await user("support-private-customer", "customer_personal");
  const agentA = await user("support-agent-a", "customer_service");
  const agentB = await user("support-agent-b", "customer_service");
  const futureAgent = await user("support-future-agent", "customer_personal");
  const admin = await user("support-admin", "admin");
  const [customerCookie, customerWrongPortalCookie, otherCustomerCookie, agentACookie, agentBCookie, futureAgentCookie, adminCookie] = await Promise.all([sessionFor(customer, "customer"), sessionFor(customer, "seller"), sessionFor(otherCustomer, "customer"), sessionFor(agentA, "support"), sessionFor(agentB, "support"), sessionFor(futureAgent, "support"), sessionFor(admin, "admin", true)]);

  const payload = { category: "PAYMENT", subject: "Payment confirmation needs review", body: "My verified payment is not reflected in the order timeline yet.", attachmentReferences: [] };
  const noOrigin = await request("/api/v1/tickets", customerCookie, "POST", payload, `ticket-no-origin-${marker}`, false);
  assert(noOrigin.response.status === 403 && noOrigin.body.error.code === "UNTRUSTED_ORIGIN", "Ticket creation accepted without trusted origin.");
  const publicAttachment = await request("/api/v1/tickets", customerCookie, "POST", { ...payload, attachmentReferences: ["https://public.example/evidence.jpg"] }, `ticket-public-${marker}`);
  assert(publicAttachment.response.status === 422, "A public support attachment URL was accepted.");
  const createKey = `ticket-create-${marker}`;
  const created = await request("/api/v1/tickets", customerCookie, "POST", payload, createKey);
  assert(created.response.status === 201 && created.body.data.ticket.status === "ASSIGNED", `Customer ticket creation failed: ${JSON.stringify(created.body)}`);
  const ticketId = created.body.data.ticket.id; ids.tickets.push(ticketId);
  const replay = await request("/api/v1/tickets", customerCookie, "POST", payload, createKey);
  assert(replay.response.status === 200 && replay.body.data.idempotentReplay, "Ticket creation retry was not idempotent.");
  const foreignReplay = await request("/api/v1/tickets", otherCustomerCookie, "POST", payload, createKey);
  assert(foreignReplay.response.status === 409 && foreignReplay.body.error.code === "IDEMPOTENCY_KEY_CONFLICT", "Another customer replayed a private ticket creation key.");
  assert(!JSON.stringify(foreignReplay.body).includes(ticketId) && !JSON.stringify(foreignReplay.body).includes(created.body.data.ticket.reference), "Ticket creation conflict exposed private ticket metadata.");
  assert(await prisma.ticket.count({ where: { idempotencyKey: createKey } }) === 1, "Foreign replay created another ticket.");
  assert(await prisma.auditLog.count({ where: { actorId: otherCustomer.id, entityId: ticketId, action: "ticket.access_denied" } }) === 1, "Foreign creation replay denial was not audited.");
  const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
  const assignedAgent = ticket.assignedAgentId === agentA.id ? agentA : agentB;
  const assignedCookie = ticket.assignedAgentId === agentA.id ? agentACookie : agentBCookie;
  const otherAgentCookie = ticket.assignedAgentId === agentA.id ? agentBCookie : agentACookie;
  assert((await request(`/api/v1/tickets/${ticketId}`, otherCustomerCookie)).response.status === 404, "Another customer read the ticket.");
  assert((await request(`/api/v1/tickets/${ticketId}`, otherAgentCookie)).response.status === 404, "An unassigned support agent read customer details.");
  assert((await request(`/api/v1/tickets/${ticketId}`, customerWrongPortalCookie)).response.status === 404, "The customer read private support data from a non-customer portal session.");
  const prematureSatisfaction = await request(`/api/v1/tickets/${ticketId}/satisfaction`, customerCookie, "POST", { score: 5, issueResolved: true, comment: "" }, `support-satisfaction-premature-${marker}`);
  assert(prematureSatisfaction.response.status === 409 && prematureSatisfaction.body.error.code === "SATISFACTION_NOT_AVAILABLE", "An active ticket accepted satisfaction feedback.");

  const unassigned = await prisma.ticket.create({ data: { reference: `TKT-UNASSIGNED-${marker.toUpperCase()}`, idempotencyKey: `ticket-unassigned-${marker}`, customerId: otherCustomer.id, category: "ACCOUNT", subject: "Private unassigned customer request", status: "OPEN", priority: "NORMAL", slaDueAt: new Date(Date.now() + 86_400_000), conversation: { create: { messages: { create: { idempotencyKey: `ticket-unassigned-message-${marker}`, senderId: otherCustomer.id, body: "This private account request must not expose my identity before assignment." } } } }, events: { create: { toStatus: "OPEN", actorId: otherCustomer.id, note: "Customer opened a support ticket." } } } });
  ids.tickets.push(unassigned.id);
  const unassignedQueue = await request("/api/v1/support/tickets?scope=unassigned", agentACookie);
  assert(unassignedQueue.response.status === 200 && JSON.stringify(unassignedQueue.body).includes(unassigned.reference), "Unassigned queue did not contain the ticket.");
  assert(!JSON.stringify(unassignedQueue.body).includes(otherCustomer.email) && !JSON.stringify(unassignedQueue.body).includes(otherCustomer.fullName), "Unassigned queue exposed customer PII.");
  const claim = await request(`/api/v1/support/tickets/${unassigned.id}/actions`, agentACookie, "PATCH", { action: "CLAIM", version: unassigned.version, note: "Claimed for account support review." });
  assert(claim.response.status === 200 && claim.body.data.ticket.assignedAgentId === agentA.id, `Unassigned ticket claim failed: ${JSON.stringify(claim.body)}`);

  const internal = await request(`/api/v1/tickets/${ticketId}/messages`, assignedCookie, "POST", { body: "Verified internal account context before replying.", attachmentReferences: [], internalNote: true }, `ticket-internal-${marker}`);
  assert(internal.response.status === 201, "Assigned agent could not add an internal note.");
  const replyKey = `ticket-reply-${marker}`;
  const reply = await request(`/api/v1/tickets/${ticketId}/messages`, assignedCookie, "POST", { body: "We are reviewing the payment record and will update you here.", attachmentReferences: [], internalNote: false }, replyKey);
  assert(reply.response.status === 201, `Assigned agent reply failed: ${JSON.stringify(reply.body)}`);
  const replyReplay = await request(`/api/v1/tickets/${ticketId}/messages`, assignedCookie, "POST", { body: "We are reviewing the payment record and will update you here.", attachmentReferences: [], internalNote: false }, replyKey);
  assert(replyReplay.response.status === 200 && replyReplay.body.data.idempotentReplay, "Message retry was not idempotent.");
  const replyConflict = await request(`/api/v1/tickets/${ticketId}/messages`, assignedCookie, "POST", { body: "A changed message must never replay under the same key.", attachmentReferences: [], internalNote: false }, replyKey);
  assert(replyConflict.response.status === 409 && replyConflict.body.error.code === "IDEMPOTENCY_KEY_CONFLICT", "A changed message reused an existing idempotency key.");
  const customerDetail = await request(`/api/v1/tickets/${ticketId}`, customerCookie);
  assert(customerDetail.response.status === 200 && !JSON.stringify(customerDetail.body).includes("Verified internal account context"), "Internal note leaked to the customer.");
  assert(!("customer" in customerDetail.body.data.ticket), "Customer API exposed the staff-only customer record block.");
  assert((await request(`/api/v1/tickets/${ticketId}/messages`, otherAgentCookie, "POST", { body: "Unauthorized cross-agent reply.", attachmentReferences: [], internalNote: false }, `ticket-cross-agent-${marker}`)).response.status === 404, "Unassigned agent replied to the ticket.");
  assert((await request(`/api/v1/tickets/${ticketId}/messages`, customerWrongPortalCookie, "POST", { body: "Wrong portal customer reply.", attachmentReferences: [], internalNote: false }, `ticket-wrong-portal-${marker}`)).response.status === 404, "A customer replied from a non-customer portal session.");
  const adminReply = await request(`/api/v1/tickets/${ticketId}/messages`, adminCookie, "POST", { body: "Admin must not impersonate Customer Service.", attachmentReferences: [], internalNote: false }, `ticket-admin-reply-${marker}`);
  assert(adminReply.response.status === 403 && adminReply.body.error.code === "SUPPORT_REPLY_ROLE_REQUIRED", "Admin published a customer-support reply.");

  let current = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
  const resolved = await request(`/api/v1/support/tickets/${ticketId}/actions`, assignedCookie, "PATCH", { action: "RESOLVE", version: current.version, note: "Payment record confirmed and customer received the resolution." });
  assert(resolved.response.status === 200 && resolved.body.data.ticket.status === "RESOLVED", "Assigned agent could not resolve the ticket.");
  const reopened = await request(`/api/v1/tickets/${ticketId}/messages`, customerCookie, "POST", { body: "I still need clarification about the confirmation date.", attachmentReferences: [], internalNote: false }, `ticket-reopen-${marker}`);
  assert(reopened.response.status === 201, "Customer could not reopen a resolved ticket by replying.");
  current = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
  assert(current.status === "WAITING_FOR_SUPPORT" && current.resolvedAt === null && current.firstResponseAt, "Reply/reopen state or first-response SLA evidence was not preserved.");
  const adminResolve = await request(`/api/v1/support/tickets/${ticketId}/actions`, adminCookie, "PATCH", { action: "RESOLVE", version: current.version, note: "Admin must remain oversight-only." });
  assert(adminResolve.response.status === 403 && adminResolve.body.error.code === "SUPPORT_AGENT_ACTION_REQUIRED", "Admin performed a Customer Service lifecycle action.");
  const reassigned = await request(`/api/v1/support/tickets/${ticketId}/actions`, adminCookie, "PATCH", { action: "ASSIGN", version: current.version, agentId: ticket.assignedAgentId === agentA.id ? agentB.id : agentA.id, note: "Reassigned for workload balancing." });
  assert(reassigned.response.status === 200 && reassigned.body.data.ticket.assignedAgentId !== assignedAgent.id, "Admin reassignment failed.");
  const adminDetail = await request(`/api/v1/tickets/${ticketId}`, adminCookie);
  assert(adminDetail.response.status === 200 && JSON.stringify(adminDetail.body).includes("Verified internal account context") && JSON.stringify(adminDetail.body).includes(customer.email), "Admin could not monitor the complete assigned transcript.");
  const reassignedAgentId = reassigned.body.data.ticket.assignedAgentId;
  const reassignedCookie = reassignedAgentId === agentA.id ? agentACookie : agentBCookie;
  current = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
  const finalResolution = await request(`/api/v1/support/tickets/${ticketId}/actions`, reassignedCookie, "PATCH", { action: "RESOLVE", version: current.version, note: "Clarification completed after reassignment." });
  assert(finalResolution.response.status === 200 && finalResolution.body.data.ticket.status === "RESOLVED", "The reassigned Customer Service agent could not resolve the ticket.");
  const satisfactionPayload = { score: 2, issueResolved: false, comment: "The answer was polite, but I still need a confirmed payment date." };
  const satisfactionKey = `support-satisfaction-${marker}`;
  const noOriginSatisfaction = await request(`/api/v1/tickets/${ticketId}/satisfaction`, customerCookie, "POST", satisfactionPayload, `support-satisfaction-no-origin-${marker}`, false);
  assert(noOriginSatisfaction.response.status === 403 && noOriginSatisfaction.body.error.code === "UNTRUSTED_ORIGIN", "Satisfaction feedback was accepted without trusted origin.");
  assert((await request(`/api/v1/tickets/${ticketId}/satisfaction`, otherCustomerCookie, "POST", satisfactionPayload, `support-satisfaction-other-${marker}`)).response.status === 404, "Another customer rated a private support ticket.");
  assert((await request(`/api/v1/tickets/${ticketId}/satisfaction`, reassignedCookie, "POST", satisfactionPayload, `support-satisfaction-agent-${marker}`)).response.status === 401, "A Customer Service agent submitted customer satisfaction feedback.");
  const satisfaction = await request(`/api/v1/tickets/${ticketId}/satisfaction`, customerCookie, "POST", satisfactionPayload, satisfactionKey);
  assert(satisfaction.response.status === 201 && satisfaction.body.data.rating.score === 2 && !satisfaction.body.data.rating.issueResolved, `Customer satisfaction submission failed: ${JSON.stringify(satisfaction.body)}`);
  assert(!("requestFingerprint" in satisfaction.body.data.rating) && !("idempotencyKey" in satisfaction.body.data.rating), "Satisfaction response exposed internal retry evidence.");
  const satisfactionReplay = await request(`/api/v1/tickets/${ticketId}/satisfaction`, customerCookie, "POST", satisfactionPayload, satisfactionKey);
  assert(satisfactionReplay.response.status === 200 && satisfactionReplay.body.data.idempotentReplay, "Satisfaction retry was not idempotent.");
  const satisfactionConflict = await request(`/api/v1/tickets/${ticketId}/satisfaction`, customerCookie, "POST", { ...satisfactionPayload, score: 3 }, satisfactionKey);
  assert(satisfactionConflict.response.status === 409 && satisfactionConflict.body.error.code === "IDEMPOTENCY_KEY_CONFLICT", "Changed satisfaction feedback reused an idempotency key.");
  const satisfactionDuplicate = await request(`/api/v1/tickets/${ticketId}/satisfaction`, customerCookie, "POST", satisfactionPayload, `support-satisfaction-duplicate-${marker}`);
  assert(satisfactionDuplicate.response.status === 409 && satisfactionDuplicate.body.error.code === "SATISFACTION_ALREADY_SUBMITTED", "A ticket accepted a second satisfaction response.");
  const satisfactionAudit = await prisma.auditLog.findFirst({ where: { actorId: customer.id, entityId: ticketId, action: "support.satisfaction_submitted" } });
  assert(satisfactionAudit && !JSON.stringify(satisfactionAudit.metadata).includes(satisfactionPayload.comment), "Satisfaction audit evidence is missing or contains the private comment.");
  const followUpNotification = await prisma.notification.findFirst({ where: { userId: admin.id, entityId: ticketId, eventType: "SUPPORT_SATISFACTION_FOLLOW_UP" } });
  assert(followUpNotification && !followUpNotification.body.includes(satisfactionPayload.comment), "Low-satisfaction follow-up was not privately notified to Admin.");
  const unauthorizedReview = await request(`/api/v1/admin/support-quality-reviews/${ticketId}`, reassignedCookie, "PUT", { score: 5, outcome: "PASS", summary: "Unauthorized agent self-review attempt.", coachingAction: null });
  assert(unauthorizedReview.response.status === 403, "A Customer Service agent reviewed their own ticket quality.");
  const qualityReview = await request(`/api/v1/admin/support-quality-reviews/${ticketId}`, adminCookie, "PUT", { score: 4, outcome: "PASS", summary: "Clear resolution with appropriate privacy and payment context.", coachingAction: null });
  assert(qualityReview.response.status === 200 && qualityReview.body.data.review.score === 4, `Admin quality review failed: ${JSON.stringify(qualityReview.body)}`);
  const staleQualityReview = await request(`/api/v1/admin/support-quality-reviews/${ticketId}`, adminCookie, "PUT", { score: 3, outcome: "COACHING_REQUIRED", summary: "A stale update must not overwrite the completed review.", coachingAction: "Review response structure.", version: 99 });
  assert(staleQualityReview.response.status === 409 && staleQualityReview.body.error.code === "QUALITY_REVIEW_CHANGED", "A stale quality review overwrote current evidence.");
  const reviewedAgentPage = await request(`/support/tickets/${ticket.reference}`, reassignedCookie);
  assert(reviewedAgentPage.response.status === 200 && reviewedAgentPage.body.includes("Clear resolution with appropriate privacy") && reviewedAgentPage.body.includes("I still need a confirmed payment date"), "The assigned agent could not see authorized quality and customer feedback.");

  const grant = await request("/api/v1/admin/support-agents", adminCookie, "POST", { email: futureAgent.email });
  assert(grant.response.status === 201, `Admin could not grant Customer Service access: ${JSON.stringify(grant.body)}`);
  const futureQueue = await request("/api/v1/support/tickets?scope=mine", futureAgentCookie);
  assert(futureQueue.response.status === 200, "A newly granted Customer Service role was not recognized by the live session.");
  // Hold the assignment lock, queue revocation, then commit an assigned ticket.
  // Revocation must wait and recheck active work after the preceding assignment.
  let locked; let release;
  const lockReady = new Promise(resolve => { locked = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  let raceTicket;
  const assignment = prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended('crossly:support-assignment', 0))");
    locked(); await gate;
    raceTicket = await tx.ticket.create({ data: { reference: `TKT-REVOKE-RACE-${marker.toUpperCase()}`, idempotencyKey: `revoke-race-${marker}`, customerId: customer.id, assignedAgentId: futureAgent.id, category: "GENERAL", subject: "Synthetic assignment before revocation", status: "ASSIGNED", slaDueAt: new Date(Date.now() + 86_400_000) } });
    ids.tickets.push(raceTicket.id);
  }, { timeout: 15_000 });
  await lockReady;
  const concurrentRevoke = request(`/api/v1/admin/support-agents/${futureAgent.id}`, adminCookie, "DELETE");
  let waiting = false;
  try {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const rows = await prisma.$queryRawUnsafe("SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND classid = ((hashtextextended('crossly:support-assignment', 0) >> 32) & 4294967295)::oid AND objid = (hashtextextended('crossly:support-assignment', 0) & 4294967295)::oid) AS waiting");
      if (rows[0].waiting) { waiting = true; break; }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  } finally { release(); await assignment; }
  const blockedRevoke = await concurrentRevoke;
  assert(waiting && blockedRevoke.response.status === 409 && blockedRevoke.body.error.code === "SUPPORT_AGENT_HAS_ACTIVE_TICKETS", "Concurrent assignment/revocation did not serialize and preserve active-ticket ownership.");
  assert(await prisma.userRole.count({ where: { userId: futureAgent.id, roleId: roles.customer_service.id } }) === 1, "Blocked concurrent revocation removed the support role.");
  assert((await request("/api/v1/support/tickets?scope=mine", futureAgentCookie)).response.status === 200, "Blocked concurrent revocation invalidated a live support session.");
  assert(await prisma.auditLog.count({ where: { entityId: futureAgent.id, action: "support.agent_role_revoked" } }) === 0, "Blocked concurrent revocation recorded a successful removal.");
  const finishRaceTicket = await request(`/api/v1/support/tickets/${raceTicket.id}/actions`, futureAgentCookie, "PATCH", { action: "RESOLVE", version: raceTicket.version, note: "Synthetic assignment race verification complete." });
  assert(finishRaceTicket.response.status === 200, "Could not finish the synthetic race ticket.");
  const offlineProfile = await request(`/api/v1/admin/support-agents/${futureAgent.id}/profile`, adminCookie, "PUT", { availability: "OFFLINE", acceptingNewTickets: false, maxActiveTickets: 1, languages: ["bn", "en"], statusNote: "Training shift" });
  assert(offlineProfile.response.status === 200 && offlineProfile.body.data.profile.availability === "OFFLINE", `Admin could not configure agent availability: ${JSON.stringify(offlineProfile.body)}`);
  const workforceTicket = await prisma.ticket.create({ data: { reference: `TKT-WORKFORCE-${marker.toUpperCase()}`, idempotencyKey: `ticket-workforce-${marker}`, customerId: otherCustomer.id, category: "GENERAL", subject: "Workforce capacity verification", status: "OPEN", priority: "NORMAL", slaDueAt: new Date(Date.now() + 86_400_000), conversation: { create: { messages: { create: { idempotencyKey: `ticket-workforce-message-${marker}`, senderId: otherCustomer.id, body: "This request verifies availability and capacity assignment rules." } } } }, events: { create: { toStatus: "OPEN", actorId: otherCustomer.id, note: "Customer opened a support ticket." } } } });
  ids.tickets.push(workforceTicket.id);
  const offlineClaim = await request(`/api/v1/support/tickets/${workforceTicket.id}/actions`, futureAgentCookie, "PATCH", { action: "CLAIM", version: workforceTicket.version, note: "Offline agent must not claim work." });
  assert(offlineClaim.response.status === 409 && offlineClaim.body.error.code === "SUPPORT_AGENT_UNAVAILABLE", "An offline agent claimed a new ticket.");
  const availableProfile = await request(`/api/v1/admin/support-agents/${futureAgent.id}/profile`, adminCookie, "PUT", { availability: "AVAILABLE", acceptingNewTickets: true, maxActiveTickets: 1, languages: ["bn", "en"], statusNote: "Available for one ticket", version: offlineProfile.body.data.profile.version });
  assert(availableProfile.response.status === 200 && availableProfile.body.data.profile.version === 2, "Admin could not reactivate the agent with optimistic version control.");
  const workforceClaim = await request(`/api/v1/support/tickets/${workforceTicket.id}/actions`, futureAgentCookie, "PATCH", { action: "CLAIM", version: workforceTicket.version, note: "Claimed within configured capacity." });
  assert(workforceClaim.response.status === 200 && workforceClaim.body.data.ticket.assignedAgentId === futureAgent.id, "An available agent could not claim within capacity.");
  const workforceResolved = await request(`/api/v1/support/tickets/${workforceTicket.id}/actions`, futureAgentCookie, "PATCH", { action: "RESOLVE", version: workforceClaim.body.data.ticket.version, note: "Capacity verification completed." });
  assert(workforceResolved.response.status === 200, "The capacity-verification ticket could not be resolved.");
  const activeRevoke = await request(`/api/v1/admin/support-agents/${agentA.id}`, adminCookie, "DELETE");
  assert(activeRevoke.response.status === 409 && activeRevoke.body.error.code === "SUPPORT_AGENT_HAS_ACTIVE_TICKETS", "Admin removed a Customer Service agent who still owns active tickets.");
  const revoke = await request(`/api/v1/admin/support-agents/${futureAgent.id}`, adminCookie, "DELETE");
  assert(revoke.response.status === 200 && revoke.body.data.revokedSessions >= 1, `Admin could not safely revoke Customer Service access: ${JSON.stringify(revoke.body)}`);
  const revokedQueue = await request("/api/v1/support/tickets?scope=mine", futureAgentCookie);
  assert(revokedQueue.response.status === 403, "A revoked Customer Service session retained support access.");
  const revokedSession = await prisma.authSession.findFirstOrThrow({ where: { userId: futureAgent.id, portal: "support" }, orderBy: { createdAt: "desc" } });
  assert(revokedSession.revokedAt, "Customer Service role revocation did not revoke the live support session.");
  const customerPage = await request(`/support/${ticketId}`, customerCookie);
  assert(customerPage.response.status === 200 && customerPage.body.includes(ticket.reference) && customerPage.body.includes("FEEDBACK SUBMITTED") && !customerPage.body.includes("Verified internal account context"), "Customer support page failed, omitted submitted feedback, or leaked an internal note.");
  const agentPage = await request(`/support/tickets/${unassigned.reference}`, agentACookie);
  assert(agentPage.response.status === 200 && agentPage.body.includes(otherCustomer.email), "Assigned Customer Service workspace did not show required customer context.");
  const foreignPage = await request(`/support/tickets/${unassigned.reference}`, agentBCookie);
  assert(foreignPage.response.status === 404 || !foreignPage.body.includes(otherCustomer.email), "Unassigned Customer Service page exposed customer PII.");
  const deniedAudits = await prisma.auditLog.count({ where: { actorId: { in: [admin.id, customer.id, agentA.id, agentB.id] }, action: "ticket.access_denied", entityId: ticketId } });
  assert(deniedAudits >= 4, "Sensitive support access denials were not recorded in the audit log.");
  console.log("Support workflow verification passed: trusted-origin and private-reference validation, payload-bound idempotency, portal and assigned-agent row isolation, internal-note privacy, exclusive Customer Service communication, Admin oversight-only controls, SLA evidence, availability/capacity enforcement, immutable customer-only satisfaction with private low-score follow-up, auditable quality reviews and agent feedback, safe role grants/revocation with session invalidation, denial auditing, notifications, and portal pages.");
} finally {
  if (ids.tickets.length) {
    await prisma.notification.deleteMany({ where: { userId: { in: ids.users } } });
    await prisma.supportSatisfactionRating.deleteMany({ where: { ticketId: { in: ids.tickets } } });
    await prisma.supportQualityReview.deleteMany({ where: { ticketId: { in: ids.tickets } } });
    const conversations = await prisma.conversation.findMany({ where: { ticketId: { in: ids.tickets } }, select: { id: true } });
    await prisma.conversationMessage.deleteMany({ where: { conversationId: { in: conversations.map((row) => row.id) } } });
    await prisma.ticketEvent.deleteMany({ where: { ticketId: { in: ids.tickets } } });
    await prisma.conversation.deleteMany({ where: { ticketId: { in: ids.tickets } } });
    await prisma.ticket.deleteMany({ where: { id: { in: ids.tickets } } });
  }
  if (ids.sessions.length) await prisma.authSession.deleteMany({ where: { id: { in: ids.sessions } } });
  if (ids.users.length) {
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: ids.users } }, { entityType: "User", entityId: { in: ids.users } }] } });
    await prisma.userRole.deleteMany({ where: { userId: { in: ids.users } } });
    await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
  }
  await prisma.$disconnect();
}
