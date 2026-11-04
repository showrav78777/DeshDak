import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";

const [shell, layout, styles] = await Promise.all([
  readFile(new URL("../src/components/admin-shell.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/app/admin/layout.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/app/admin-shell.css", import.meta.url), "utf8"),
]);

const requiredDestinations = [
  "/admin/orders", "/admin/purchases", "/admin/shipping-quotes", "/admin/products", "/admin/categories",
  "/admin/sellers", "/admin/seller-orders", "/admin/reels", "/admin/coupons", "/admin/promotions", "/admin/customers", "/admin/sales",
  "/admin/payment-methods", "/admin/fx-rates", "/admin/refunds", "/admin/sourcing", "/admin/source-integrations",
  "/admin/countries", "/admin/warehouses", "/admin/warehouse-operations", "/admin/warehouse-exceptions",
  "/admin/compliance",
  "/admin/package-services", "/admin/rmas", "/admin/support", "/admin/support/settings", "/admin/help",
  "/admin/notifications", "/admin/ai", "/admin/system-maintenance",
  "/admin/audit-logs",
  "/admin/launch-readiness",
];

for (const destination of requiredDestinations) assert.match(shell, new RegExp(`href: "${destination.replaceAll("/", "\\/")}"`), `Missing Admin destination: ${destination}`);
assert.match(shell, /aria-current=\{active \? "page"/, "Active navigation must be announced");
assert.match(shell, /aria-expanded=\{menuOpen\}/, "Mobile menu state must be announced");
assert.match(shell, /Skip to main content/, "Keyboard users need a skip link");
assert.match(shell, /pathname === "\/admin\/login"/);
assert.match(shell, /pathname === "\/admin\/setup"/);
assert.match(shell, /packages\\\/\[\^\/\]\+\\\/label/, "Print labels must bypass the workspace shell");
assert.match(layout, /session\.portal !== "admin"/, "Only an authenticated Admin portal session may receive the shell");
assert.match(styles, /\.admin-sidebar-navigation\{[^}]*overflow-y:auto/, "Sidebar options must scroll independently");
assert.match(styles, /\.admin-workspace-main\{[^}]*overflow:auto/, "Admin content must scroll independently");
assert.match(styles, /@media\(max-width:900px\)/, "Admin shell must provide a mobile layout");
assert.match(styles, /:focus-visible/, "Admin shell must retain visible focus states");

const authSecret = process.env.AUTH_SECRET;
if (!authSecret) throw new Error("AUTH_SECRET is required for Admin shell runtime verification.");
const prisma = new PrismaClient();
const origin = new URL(process.env.TEST_BASE_URL ?? process.env.APP_BASE_URL ?? "http://localhost:3000").origin;
const marker = randomBytes(8).toString("hex");
let userId;
let sessionId;

async function request(path, token) {
  return fetch(`${origin}${path}`, { headers: token ? { Cookie: `crossly_session=${token}; __Host-crossly_session=${token}` } : {}, redirect: "manual" });
}

try {
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: "admin" } });
  const user = await prisma.user.create({ data: { email: `admin-shell-${marker}@example.test`, fullName: `Navigation QA ${marker}`, passwordHash: "not-used", status: "ACTIVE", roles: { create: { roleId: adminRole.id } } } });
  userId = user.id;
  const session = await prisma.authSession.create({ data: { userId, portal: "admin", clientName: "Admin shell verification", clientType: "WEB", expiresAt: new Date(Date.now() + 3_600_000), mfaVerifiedAt: new Date() } });
  sessionId = session.id;
  const token = await new SignJWT({ email: user.email, name: user.fullName, roles: ["admin"] }).setProtectedHeader({ alg: "HS256" }).setJti(session.id).setSubject(user.id).setIssuer(process.env.AUTH_ISSUER ?? "http://localhost:3000").setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(authSecret));

  const adminResponse = await request("/admin/orders", token);
  const adminHtml = await adminResponse.text();
  assert.equal(adminResponse.status, 200, "Authenticated Admin page did not render");
  assert.match(adminHtml, /Administrator navigation/, "Authenticated Admin page omitted the shared navigation");
  for (const destination of ["/admin", ...requiredDestinations]) {
    const response = await request(destination, token);
    const html = await response.text();
    assert.equal(response.status, 200, `Admin page failed to render: ${destination}`);
    assert.match(html, /Administrator navigation/, `Admin navigation missing: ${destination}`);
  }
  assert.match(adminHtml, new RegExp(`Navigation QA ${marker}`), "Admin display name was not shown");
  assert.match(adminHtml, /href="\/admin\/orders"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/admin\/orders"/, "Current Admin route was not marked active");
  assert.match(styles, />\.dashboard-shell>\.site-nav[^}]*display:none/, "Legacy page navigation must be visually superseded inside the shell");

  const publicLogin = await request("/admin/login");
  const loginHtml = await publicLogin.text();
  assert.equal(publicLogin.status, 200, "Admin login page did not render");
  assert.doesNotMatch(loginHtml, /Administrator navigation/, "Admin login leaked the protected navigation shell");

  const wrongPortalSession = await prisma.authSession.create({ data: { userId, portal: "customer", clientName: "Admin shell wrong portal verification", clientType: "WEB", expiresAt: new Date(Date.now() + 3_600_000), mfaVerifiedAt: new Date() } });
  const wrongPortalToken = await new SignJWT({ email: user.email, name: user.fullName, roles: ["admin"] }).setProtectedHeader({ alg: "HS256" }).setJti(wrongPortalSession.id).setSubject(user.id).setIssuer(process.env.AUTH_ISSUER ?? "http://localhost:3000").setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(authSecret));
  const wrongPortal = await request("/admin/orders", wrongPortalToken);
  assert.equal(wrongPortal.status, 307, "An Admin identity in the wrong portal was not rejected");
  assert.equal(wrongPortal.headers.get("location"), "/", "Wrong-portal Admin rejection changed unexpectedly");

  console.log(`Admin shell verification passed (${requiredDestinations.length} destinations, authenticated render, active route, standalone login, and portal isolation checked).`);
} finally {
  if (userId) {
    await prisma.auditLog.deleteMany({ where: { actorId: userId } });
    await prisma.authSession.deleteMany({ where: { userId } });
    await prisma.userRole.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  } else if (sessionId) {
    await prisma.authSession.deleteMany({ where: { id: sessionId } });
  }
  await prisma.$disconnect();
}
