import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";

const prisma = new PrismaClient();
const origin = new URL(process.env.TEST_BASE_URL ?? process.env.APP_BASE_URL ?? "http://localhost:3000").origin;
const authSecret = process.env.AUTH_SECRET;
if (!authSecret) throw new Error("AUTH_SECRET is required for launch-readiness verification.");
const marker = randomBytes(8).toString("hex");
const ids = { users: [], sessions: [], items: [] };

async function tokenFor(user, portal) {
  const session = await prisma.authSession.create({ data: { userId: user.id, portal, clientName: "Launch-readiness verification", clientType: "WEB", expiresAt: new Date(Date.now() + 3_600_000), mfaVerifiedAt: new Date() } });
  ids.sessions.push(session.id);
  return new SignJWT({ email: user.email, name: user.fullName, roles: ["admin"] }).setProtectedHeader({ alg: "HS256" }).setJti(session.id).setSubject(user.id).setIssuer(process.env.AUTH_ISSUER ?? "http://localhost:3000").setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(authSecret));
}

async function call(path, token, method = "GET", body, trusted = true) {
  const response = await fetch(`${origin}${path}`, { method, headers: { ...(token ? { Cookie: `crossly_session=${token}; __Host-crossly_session=${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...(trusted ? { Origin: origin } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
  const text = await response.text();
  return { response, text, body: response.headers.get("content-type")?.includes("json") ? JSON.parse(text) : null };
}

try {
  const adminRole = await prisma.role.upsert({ where: { code: "admin" }, update: {}, create: { code: "admin", description: "Platform administrator" } });
  const admin = await prisma.user.create({ data: { email: `launch-admin-${marker}@example.test`, fullName: `Launch Admin ${marker}`, passwordHash: "not-used", status: "ACTIVE", roles: { create: { roleId: adminRole.id } } } });
  ids.users.push(admin.id);
  const [adminToken, wrongPortalToken] = await Promise.all([tokenFor(admin, "admin"), tokenFor(admin, "customer")]);

  assert.equal((await call("/api/v1/admin/launch-readiness", null)).response.status, 403, "Anonymous readiness access was not denied.");
  assert.equal((await call("/api/v1/admin/launch-readiness", wrongPortalToken)).response.status, 403, "Wrong-portal Admin access was not denied.");
  assert([302, 303, 307, 308].includes((await call("/admin/launch-readiness/report", null)).response.status), "Anonymous report access was not redirected to Admin login.");
  assert([302, 303, 307, 308].includes((await call("/admin/launch-readiness/report", wrongPortalToken)).response.status), "Wrong-portal report access was not redirected to Admin login.");
  const baseline = await call("/api/v1/admin/launch-readiness", adminToken);
  for (const token of [null, wrongPortalToken]) assert([302, 303, 307, 308].includes((await call("/admin/launch-readiness/setup", token)).response.status), "Live setup guide did not protect the Admin boundary.");
  const setupGuide = await call("/admin/launch-readiness/setup", adminToken);
  assert.equal(setupGuide.response.status, 200);
  for (const heading of ["Set up DeshDak for live use.", "Phone verification and SMS", "Private identity and inspection media", "Integration / certification required"]) assert(setupGuide.text.includes(heading), `Setup guidance missing: ${heading}`);
  assert(setupGuide.response.headers.get("cache-control")?.includes("no-store"), "Live setup guide may be cached.");
  for (const secret of [process.env.DATABASE_URL, process.env.AUTH_SECRET, process.env.MFA_ENCRYPTION_KEY, process.env.MAINTENANCE_JOB_SECRET, process.env.WEBSITE_MEDIA_SCAN_TOKEN].filter(Boolean)) assert(!setupGuide.text.includes(secret), "Live setup guide exposed an environment value.");
  for (const text of ["Website images and promotional content", "WEBSITE_MEDIA_SCAN_URL", "WEBSITE_MEDIA_SCAN_TOKEN", "Direct video-file upload"]) assert(setupGuide.text.includes(text), `Website media guidance missing: ${text}`);
  assert.equal(baseline.response.status, 200, baseline.text);
  assert.equal(baseline.response.headers.get("cache-control"), "private, no-store, max-age=0", "Readiness evidence may be cached.");
  const expectedBaselineKeys = ["production-infrastructure", "payment-provider", "captcha-email", "private-media", "legal-policy", "warehouse-lane", "named-staff", "independent-security", "production-automation", "staging-environment", "role-journey-acceptance", "device-accessibility-acceptance", "release-freeze-approval"];
  const baselineKeys = new Set(baseline.body.data.items.filter((item) => item.isBaseline && item.isRequired).map((item) => item.key));
  assert(expectedBaselineKeys.every((key) => baselineKeys.has(key)), "Required baseline launch gates are missing.");
  assert(baseline.body.data.items.filter((item) => item.isBaseline).every((item) => item.events.length >= 1), "Baseline launch history was not initialized.");
  assert.equal(baseline.body.data.technicalSignals.length, 7, "Machine-checked launch signals are incomplete.");
  assert.equal(baseline.body.data.technicalSignals.find((signal) => signal.code === "DATABASE")?.status, "PASS", "Database readiness signal failed.");
  for (const secret of [process.env.DATABASE_URL, process.env.AUTH_SECRET, process.env.MFA_ENCRYPTION_KEY].filter(Boolean)) assert(!baseline.text.includes(secret), "A technical readiness response exposed an environment value.");
  const mediaSignal = baseline.body.data.technicalSignals.find(signal => signal.code === "PRIVATE_MEDIA_IMPLEMENTATION");
  assert.equal(mediaSignal?.status, "FAIL");
  assert(mediaSignal.detail.includes("video") && mediaSignal.detail.includes("credentials alone"));
  const mediaGate = baseline.body.data.items.find(item => item.key === "private-media");
  const beforeMedia = await prisma.launchReadinessItem.findUniqueOrThrow({ where: { id: mediaGate.id } });
  const mediaInput = { category: mediaGate.category, title: mediaGate.title, requirement: mediaGate.requirement, ownerName: "Synthetic reviewer", dueAt: null, evidenceReference: "SYNTHETIC-NOT-LIVE-ACCEPTANCE", evidenceNote: "Synthetic attempted bypass; never live acceptance.", blockerReason: null, version: mediaGate.version, verificationConfirmed: true, status: "VERIFIED", isRequired: true };
  for (const patch of [mediaInput, { ...mediaInput, category: "OTHER", title: "Renamed media gate", status: "IN_PROGRESS", isRequired: false, verificationConfirmed: false }]) {
    const denied = await call(`/api/v1/admin/launch-readiness/${mediaGate.id}`, adminToken, "PATCH", patch);
    assert.equal(denied.response.status, 409, denied.text);
    assert.equal(denied.body.error.code, "PRIVATE_MEDIA_IMPLEMENTATION_REQUIRED");
  }
  assert.deepEqual(await prisma.launchReadinessItem.findUniqueOrThrow({ where: { id: mediaGate.id } }), beforeMedia, "Denied verification changed the media gate.");
  assert.equal(await prisma.auditLog.count({ where: { actorId: admin.id, action: "launch_readiness.verification_blocked", entityId: mediaGate.id } }), 2);
  const publicCatalog = await call("/api/v1/catalog/categories", null);
  assert.equal(publicCatalog.response.status, 200, "Public catalog cache-boundary probe failed.");
  assert(publicCatalog.response.headers.get("cache-control")?.includes("public"), "Private-page hardening disabled intentional public catalog caching.");

  const input = { category: "OTHER", title: `Controlled launch check ${marker}`, requirement: "Provide approved operational evidence before this launch gate is verified.", isRequired: true, ownerName: "Named owner", dueAt: null };
  assert.equal((await call("/api/v1/admin/launch-readiness", adminToken, "POST", input, false)).response.status, 403, "Untrusted creation was not denied.");
  const created = await call("/api/v1/admin/launch-readiness", adminToken, "POST", input);
  assert.equal(created.response.status, 201, created.text); ids.items.push(created.body.data.item.id);

  const id = created.body.data.item.id; const base = { ...input, status: "BLOCKED", evidenceReference: null, evidenceNote: null, blockerReason: null, version: 1, verificationConfirmed: false };
  assert.equal((await call(`/api/v1/admin/launch-readiness/${id}`, adminToken, "PATCH", base)).response.status, 422, "A blocked gate without reason was accepted.");
  const leaked = { ...base, status: "EVIDENCE_RECORDED", blockerReason: null, evidenceReference: `token=${marker}`, evidenceNote: "Reviewed evidence." };
  assert.equal((await call(`/api/v1/admin/launch-readiness/${id}`, adminToken, "PATCH", leaked)).response.status, 422, "A credential-like evidence value was accepted.");
  const evidence = { ...leaked, evidenceReference: `SEC-REVIEW-${marker}` };
  const recorded = await call(`/api/v1/admin/launch-readiness/${id}`, adminToken, "PATCH", evidence);
  assert.equal(recorded.response.status, 200, recorded.text);
  assert.equal(recorded.body.data.item.version, 2);
  assert.equal((await call(`/api/v1/admin/launch-readiness/${id}`, adminToken, "PATCH", evidence)).response.status, 409, "A stale version update was accepted.");
  const verifyInput = { ...evidence, status: "VERIFIED", version: 2 };
  assert.equal((await call(`/api/v1/admin/launch-readiness/${id}`, adminToken, "PATCH", verifyInput)).response.status, 422, "Verification without explicit confirmation was accepted.");
  const verified = await call(`/api/v1/admin/launch-readiness/${id}`, adminToken, "PATCH", { ...verifyInput, verificationConfirmed: true });
  assert.equal(verified.response.status, 200, verified.text);
  assert(verified.body.data.item.verifiedAt && verified.body.data.item.verifiedBy.personCode === admin.personCode, "Verifier evidence was not retained.");
  const page = await call("/admin/launch-readiness", adminToken);
  assert.equal(page.response.status, 200, "Launch-readiness Admin page did not render.");
  assert(page.text.includes("Private media implementation") && page.text.includes("broader linked-media cleanup/recovery"));
  assert(page.text.includes("Launch readiness register.") && page.text.includes("Machine-checked signals") && page.text.includes("Open printable evidence report") && page.text.includes(`Controlled launch check ${marker}`), "Launch-readiness page omitted technical signals, the report link, or the verified item.");
  const report = await call("/admin/launch-readiness/report", adminToken);
  assert.equal(report.response.status, 200, "Launch evidence report did not render.");
  const reportCacheControl = report.response.headers.get("cache-control");
  // no-store forbids storage by both shared and private caches; private is redundant.
  const productionNoStore = reportCacheControl?.split(",").some(directive => directive.trim().toLowerCase() === "no-store");
  const nextDevelopmentRevalidation = process.env.NODE_ENV !== "production"
    && reportCacheControl === "no-cache, must-revalidate";
  assert(productionNoStore || nextDevelopmentRevalidation, `The launch evidence report may be cached (${reportCacheControl ?? "header missing"}).`);
  assert.equal(report.response.headers.get("x-frame-options"), "DENY", "The launch evidence report may be framed.");
  assert(report.response.headers.get("x-robots-tag")?.includes("noindex"), "The launch evidence report may be indexed.");
  assert(report.text.includes("Launch evidence report") && report.text.includes("Print or save as PDF") && report.text.includes(`Controlled launch check ${marker}`) && report.text.includes(`SEC-REVIEW-${marker}`), "Launch evidence report omitted controlled evidence.");
  for (const secret of [process.env.DATABASE_URL, process.env.AUTH_SECRET, process.env.MFA_ENCRYPTION_KEY].filter(Boolean)) assert(!report.text.includes(secret), "The printable report exposed an environment value.");
  const controlCenter = await call("/admin", adminToken);
  assert.equal(controlCenter.response.status, 200, "Admin control center did not render.");
  assert(controlCenter.text.includes("PAID LAUNCH READINESS") && controlCenter.text.includes("Review gates"), "Admin control center omitted launch-readiness visibility.");
  // Historical/manual VERIFIED records must not override current implementation failures.
  const requiredSnapshots = await prisma.launchReadinessItem.findMany({ where: { isRequired: true }, select: { id: true, status: true } });
  try {
    await prisma.launchReadinessItem.updateMany({ where: { id: { in: requiredSnapshots.map(item => item.id) } }, data: { status: "VERIFIED" } });
    for (const path of ["/admin/launch-readiness", "/admin/launch-readiness/report", "/admin"]) {
      const staleReady = await call(path, adminToken);
      assert.equal(staleReady.response.status, 200);
      assert(!staleReady.text.includes("READY FOR FINAL APPROVAL") && !staleReady.text.includes("All required evidence is verified"), "Stored evidence bypassed an implementation failure.");
      assert(staleReady.text.includes(path === "/admin" ? "Private media engineering is incomplete" : "BLOCKED"));
    }
  } finally {
    await prisma.$transaction(requiredSnapshots.map(item => prisma.launchReadinessItem.update({ where: { id: item.id }, data: { status: item.status } })));
  }
  const audits = await prisma.auditLog.findMany({ where: { entityType: "LaunchReadinessItem", entityId: id } });
  assert.equal(audits.length, 3, "Create/evidence/verification audit history is incomplete.");
  const events = await prisma.launchReadinessEvent.findMany({ where: { itemId: id }, orderBy: { itemVersion: "asc" } });
  assert.equal(events.length, 3, "Immutable launch decision history is incomplete.");
  assert.deepEqual(events.map((event) => event.itemVersion), [1, 2, 3], "Launch history versions are not monotonic.");
  assert.equal(events[1].evidenceReferenceSnapshot, `SEC-REVIEW-${marker}`, "Evidence snapshot was not retained.");
  assert.equal(events[2].toStatus, "VERIFIED", "Final verification transition was not retained.");
  console.log("Launch-readiness verification passed: Admin isolation, baseline gates, seven non-secret technical signals, trusted mutations, evidence rules, secret rejection, optimistic versions, immutable decision snapshots, verifier identity, audit history, register rendering, protected printable report, and control-center visibility.");
} finally {
  if (ids.items.length) { await prisma.auditLog.deleteMany({ where: { entityType: "LaunchReadinessItem", entityId: { in: ids.items } } }); await prisma.launchReadinessEvent.deleteMany({ where: { itemId: { in: ids.items } } }); await prisma.launchReadinessItem.deleteMany({ where: { id: { in: ids.items } } }); }
  if (ids.sessions.length) await prisma.authSession.deleteMany({ where: { id: { in: ids.sessions } } });
  if (ids.users.length) { await prisma.auditLog.deleteMany({ where: { actorId: { in: ids.users } } }); await prisma.userRole.deleteMany({ where: { userId: { in: ids.users } } }); await prisma.user.deleteMany({ where: { id: { in: ids.users } } }); }
  await prisma.$disconnect();
}
