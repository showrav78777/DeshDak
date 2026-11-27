import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { SignJWT } from "jose";

/** Permanent quarantine fixtures are retained until the owned schema is dropped. */
export async function verifyPrivateVideoSafety(context) {
  const { db, source, artifacts, provenance, account, store, processor, raw, binding, readKeys, setOnRead, setOnPut } = context;
  const origin = process.env.TEST_BASE_URL, marker = randomBytes(8).toString("hex");
  const retention = await source("modules/private-storage/video-retention", { "./video-provenance": provenance, "./video-artifacts": artifacts });
  const { createVideoSafety } = await import(await source("modules/private-storage/video-safety", { "./video-retention": retention, "@/modules/auth/account-mutation": account }));
  // video-jobs imports its reference parser at runtime.
  const jobsSource = await source("modules/private-storage/video-jobs", { "./video-artifacts": artifacts });
  const { createPrivateVideoJobs } = await import(jobsSource);
  const { createPrivateVideoIntake: makeIntake } = await import(await source("modules/private-storage/video-intake", { "./video-jobs": jobsSource, "./video-provenance": provenance, "./video-authorization": await source("modules/private-storage/video-authorization", { "@/modules/auth/account-mutation": account }) }));
  const controls = createVideoSafety(db), intake = makeIntake(db, store, processor), jobs = createPrivateVideoJobs(db, store);
  async function now() { return (await db.$queryRaw`SELECT clock_timestamp()::timestamp(3) AS "now"`)[0].now; }
  async function actor(label, roleCode, portal, mfa = false) {
    const role = await db.role.findUniqueOrThrow({ where: { code: roleCode } });
    const user = await db.user.create({ data: { email: `video-safety-${label}-${marker}@example.test`, fullName: "Synthetic video safety", status: "ACTIVE", passwordHash: "unused", roles: { create: { roleId: role.id } } } });
    const clock = await now(), session = await db.authSession.create({ data: { userId: user.id, portal, mfaVerifiedAt: mfa ? clock : null, expiresAt: new Date(clock.getTime() + 3600000), clientType: "WEB" } });
    const token = await new SignJWT({ email: user.email, name: user.fullName, roles: [roleCode] }).setProtectedHeader({ alg: "HS256" }).setJti(session.id).setSubject(user.id).setIssuer(process.env.AUTH_ISSUER ?? origin).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(process.env.AUTH_SECRET));
    return { user, session, token, cookie: `crossly_session=${token}; __Host-crossly_session=${token}` };
  }
  const admin = await actor("admin", "admin", "admin", true), owner = await actor("owner", "customer_personal", "customer"), staff = await actor("staff", "inspector", "inspector");
  const warehouse = await db.warehouse.create({ data: { name: `Video safety ${marker}`, country: "CN", type: "ORIGIN" } });
  await db.warehouseStaffAssignment.create({ data: { userId: staff.user.id, warehouseId: warehouse.id, assignedById: admin.user.id } });
  const order = await db.order.create({ data: { customerId: owner.user.id, orderNumber: `VSAFE-${marker}`, grandTotal: 0, status: "WAREHOUSE_RECEIVED" } });
  const parcel = await db.package.create({ data: { orderId: order.id, warehouseId: warehouse.id, status: "RECEIVED", packageCode: `VSAFE-${marker.toUpperCase()}` } });
  const input = label => ({ actorId: staff.user.id, sessionId: staff.session.id, packageId: parcel.id, requestKey: `video-safety-${marker}-${label}`, file: new File([raw], "PRIVATE_SAFETY_FILENAME.mp4", { type: "video/mp4" }) });
  async function bundle(label) { const stored = await intake.submit(input(label)); assert.equal(stored.state, "STORED"); return { ...stored, ...await binding.bind({ actorId: staff.user.id, sessionId: staff.session.id, jobId: stored.jobId }) }; }
  const primary = await bundle("primary");
  const policy = await db.privateMediaPolicy.findFirst({ orderBy: { sequence: "desc" } });
  if (!policy) assert.equal((await controls.list(admin.session.id, {})).items.find(row => row.id === primary.jobId).retention.state, "POLICY_REQUIRED");
  await db.privateMediaPolicy.create({ data: { sequence: (policy?.sequence ?? 0) + 1, identityDays: 90, inspectionDays: 1, abandonedHours: 24, caseReference: "OPS-VIDEO-TEST", actorId: admin.user.id, idempotencyKey: randomUUID() } });
  const row = async () => (await controls.list(admin.session.id, {})).items.find(item => item.id === primary.jobId);
  assert.equal((await row()).retention.state, "DELIVERY_REVIEW_REQUIRED");
  const reviewer = await actor("reviewer", "admin", "admin", true);
  await db.userRole.create({ data: { userId: reviewer.user.id, roleId: (await db.role.findUniqueOrThrow({ where: { code: "compliance" } })).id } });
  const hold = await db.privateMediaHold.create({ data: { packageId: parcel.id, actorId: admin.user.id, caseReference: "SEC-VIDEO-HOLD", idempotencyKey: randomUUID() } });
  assert.equal((await row()).retention.state, "LEGAL_HOLD");
  await db.privateMediaHoldRelease.create({ data: { holdId: hold.id, actorId: reviewer.user.id, caseReference: "SEC-VIDEO-REVIEWED", idempotencyKey: randomUUID() } });
  const clock = await now(), past = new Date(clock.getTime() - 5 * 86400000), later = hours => new Date(past.getTime() + hours * 3600000);
  await db.privateVideoJob.update({ where: { id: primary.jobId }, data: { createdAt: past, updatedAt: later(1) } });
  await db.privateVideoProcessingProof.update({ where: { jobId: primary.jobId }, data: { verifiedAt: later(1) } });
  await db.inspectionEvidence.update({ where: { id: primary.evidenceId }, data: { createdAt: later(2) } });
  await db.order.update({ where: { id: order.id }, data: { status: "DELIVERED" } });
  await db.orderStatusHistory.create({ data: { orderId: order.id, fromStatus: "OUT_FOR_DELIVERY", toStatus: "DELIVERED", actorId: admin.user.id, createdAt: later(3) } });
  const deadline = new Date(clock.getTime() + 2 * 86400000);
  const shipment = await db.shipment.create({ data: { trackingNumber: `VSAFE-SHIP-${marker}`, status: "DELIVERED", deliveredAt: later(4), updatedAt: later(5), claimDeadline: deadline, packages: { create: { packageId: parcel.id } }, events: { create: { status: "DELIVERED", occurredAt: later(4) } } } });
  const waiting = await row(); assert.equal(waiting.retention.state, "RETENTION_RUNNING"); assert(new Date(waiting.retention.reviewAfter) >= deadline);
  await db.shipment.update({ where: { id: shipment.id }, data: { claimDeadline: later(12), updatedAt: later(5) } });
  assert.equal((await row()).retention.state, "INDEPENDENT_REVIEW_REQUIRED"); assert.equal((await row()).retention.deletionAllowed, false);
  const ticket = await db.ticket.create({ data: { reference: `VSAFE-${marker}`, idempotencyKey: randomUUID(), customerId: owner.user.id, orderId: order.id, category: "GENERAL", subject: "SYNTHETIC_CONFIDENTIAL_CASE", slaDueAt: deadline } });
  assert.equal((await row()).retention.state, "CASE_REVIEW_REQUIRED");
  await db.ticket.update({ where: { id: ticket.id }, data: { status: "CLOSED", resolvedAt: new Date(clock.getTime() - 1000), updatedAt: new Date(clock.getTime() - 1000) } });
  assert.equal((await row()).retention.state, "RETENTION_RUNNING");
  await db.ticket.createMany({ data: Array.from({ length: 50 }, (_, index) => ({ reference: `VSAFE-${marker}-${index}`, idempotencyKey: randomUUID(), customerId: owner.user.id, orderId: order.id, category: "GENERAL", subject: "SYNTHETIC_CONFIDENTIAL_CASE", slaDueAt: deadline, status: "CLOSED", resolvedAt: past, updatedAt: past })) });
  assert.equal((await row()).retention.state, "HISTORY_REVIEW_REQUIRED");

  const queue = `${origin}/api/v1/admin/private-videos`, quarantine = id => `${queue}/${id}/quarantine`;
  async function post(id, cookie = admin.cookie, body = { reason: "PRIVACY_REVIEW", caseReference: "SEC-VIDEO-CASE", confirmed: true }, key = randomUUID(), headers = {}) {
    const response = await fetch(quarantine(id), { method: "POST", headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json", "Idempotency-Key": key, ...headers }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }
  assert.equal((await fetch(queue, { headers: { Cookie: owner.cookie } })).status, 403);
  assert.equal((await post(primary.jobId, staff.cookie)).status, 403);
  assert.equal((await post(primary.jobId, admin.cookie, undefined, randomUUID(), { Origin: "https://untrusted.example.test" })).status, 403);
  assert.equal((await post(primary.jobId, admin.cookie, { reason: "PRIVACY_REVIEW", caseReference: "SEC-VIDEO-CASE", confirmed: false })).status, 422);
  assert.equal((await post(primary.jobId, admin.cookie, undefined, "invalid")).status, 422);
  assert.equal((await fetch(`${queue}?delete=true`, { headers: { Cookie: admin.cookie } })).status, 422);
  const list = await fetch(queue, { headers: { Cookie: admin.cookie } }); assert.equal(list.status, 200); assert.match(list.headers.get("cache-control"), /no-store/);
  const data = await list.json(); assert.equal(data.data.deletionEnabled, false);
  assert(!JSON.stringify(data).includes("private/inspection-video/")); assert(!JSON.stringify(data).includes("manifest")); assert(!JSON.stringify(data).includes("SYNTHETIC_CONFIDENTIAL_CASE"));
  for (const time of [null, new Date(clock.getTime() - 16 * 60000), new Date(clock.getTime() + 60000)]) {
    await db.authSession.update({ where: { id: admin.session.id }, data: { mfaVerifiedAt: time } }); assert.equal((await fetch(queue, { headers: { Cookie: admin.cookie } })).status, 403);
  } await db.authSession.update({ where: { id: admin.session.id }, data: { mfaVerifiedAt: await now() } });
  const key = randomUUID();
  setOnRead(async () => { const result = await post(primary.jobId, admin.cookie, undefined, key); assert.equal(result.status, 201); });
  const previewUrl = await source("modules/private-storage/video-preview", { "@/modules/auth/account-mutation": account, "./video-artifacts": artifacts, "./video-provenance": provenance, "./video-byte-range": await source("modules/private-storage/video-byte-range") });
  const { createPrivateVideoPreview } = await import(previewUrl);
  await assert.rejects(() => createPrivateVideoPreview(db, store).read({ sessionId: staff.session.id, evidenceId: primary.evidenceId, artifact: "video" }), /PRIVATE_VIDEO_PREVIEW_DENIED/);
  assert.equal((await post(primary.jobId, admin.cookie, undefined, key)).status, 200);
  assert.equal((await post(primary.jobId)).status, 409);
  assert.equal(await db.privateVideoQuarantine.count({ where: { jobId: primary.jobId } }), 1);
  assert.equal(await db.auditLog.count({ where: { entityId: primary.jobId, action: "private_video.quarantined" } }), 1);
  await assert.rejects(() => db.privateVideoQuarantine.update({ where: { jobId: primary.jobId }, data: { reason: "INTEGRITY_FAILURE" } }), /immutable/);
  await assert.rejects(() => db.privateVideoQuarantine.delete({ where: { jobId: primary.jobId } }), /immutable/);
  const before = readKeys.length;
  await assert.rejects(() => binding.bind({ actorId: staff.user.id, sessionId: staff.session.id, jobId: primary.jobId }));
  await assert.rejects(() => intake.submit(input("primary"))); await assert.rejects(() => jobs.run(primary.jobId)); assert.equal(readKeys.length, before);
  assert.equal((await row()).retention.state, "QUARANTINED");
  const racedInput = input("mid-write"), racedKey = createHash("sha256").update(JSON.stringify(["inspection-video-intake:v1", racedInput.requestKey])).digest("hex");
  setOnPut(async () => { const job = await db.privateVideoJob.findUniqueOrThrow({ where: { actorId_idempotencyKey: { actorId: staff.user.id, idempotencyKey: racedKey } } }); await controls.block(admin.session.id, job.id, { reason: "INTEGRITY_FAILURE", caseReference: "SEC-VIDEO-RACE", confirmed: true, idempotencyKey: randomUUID() }); });
  assert.equal((await intake.submit(racedInput)).state, "REVIEW_REQUIRED");

  const { chromium } = await import("@playwright/test"), browser = await chromium.launch({ headless: true });
  try {
    for (const [label, width, height] of [["desktop", 1440, 1000], ["mobile", 390, 844]]) {
      const ui = await bundle(`ui-${label}`), context = await browser.newContext({ viewport: { width, height } });
      await context.addCookies([{ name: "crossly_session", value: admin.token, url: origin }]);
      const page = await context.newPage(); await page.goto(`${origin}/admin/private-videos`);
      await page.getByRole("heading", { name: "Review inspection video bundles" }).waitFor();
      const card = page.locator("article").filter({ hasText: ui.jobId }); await card.locator("summary").click();
      await card.getByLabel("Reason", { exact: true }).selectOption("PRIVACY_REVIEW"); await card.getByLabel("Case reference", { exact: true }).fill("SEC-VIDEO-UI-20261127"); await card.getByRole("checkbox").check();
      const attempts = []; let interrupted = false;
      if (label === "desktop") await page.route("**/api/v1/admin/private-videos/*/quarantine", async route => { attempts.push({ key: route.request().headers()["idempotency-key"], body: route.request().postData() }); if (!interrupted) { interrupted = true; const response = await route.fetch(); await response.body(); await response.dispose(); await route.abort(); } else await route.continue(); });
      await card.getByRole("button", { name: "Confirm video quarantine", exact: true }).click();
      if (label === "desktop") { await card.getByRole("alert").waitFor(); assert(await card.getByLabel("Case reference", { exact: true }).isDisabled()); await card.getByRole("button", { name: "Confirm video quarantine", exact: true }).click(); }
      await card.getByRole("status").waitFor(); assert(await db.privateVideoQuarantine.findUnique({ where: { jobId: ui.jobId } }));
      if (label === "desktop") { assert.equal(attempts.length, 2); assert.deepEqual(attempts[0], attempts[1]); }
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.waitForLoadState("networkidle"); await page.screenshot({ path: `/tmp/deshdak-video-safety-${label}-20261127.png`, fullPage: false }); await context.close();
    }
  } finally { await browser.close(); setOnRead(null); setOnPut(null); }
  console.log("Private video safety passed: fresh Admin MFA/CSRF/validation, redacted queue, policy/claim/case/hold/history retention blockers with deletion disabled, immutable quarantine, blocked preview/binding/retry and quarantine during reads/PUT, and desktop/mobile lost-response replay with stable payload/key. All permanent synthetic records remain only until owned schema removal; no media deletion or production activation.");
}
