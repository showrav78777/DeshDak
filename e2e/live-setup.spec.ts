import { createHmac } from "node:crypto";
import { test, expect } from "./fixtures";

function code(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret].map(c => alphabet.indexOf(c).toString(2).padStart(5, "0")).join("");
  const bytes = []; for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest(); const offset = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}
test.use({ trace: "off", screenshot: "off", actionTimeout: 10_000 });
test.describe.configure({ retries: 0 });
test("Admin live setup guide explains remaining configuration", async ({ browser, baseURL }, info) => {
  test.skip(!process.env.E2E_LIVE_SETUP_ADMINS, "Requires isolated Admin fixtures."); test.setTimeout(120_000);
  const admin = JSON.parse(process.env.E2E_LIVE_SETUP_ADMINS!)[info.project.name];
  const viewport = info.project.name === "mobile" ? { width: 375, height: 812 } : { width: 1440, height: 1000 };
  const context = await browser.newContext({ baseURL, viewport, storageState: { cookies: [], origins: [] } });
  try {
    expect((await context.request.post("/api/v1/auth/login", { headers: { Origin: baseURL! }, data: { email: admin.email, password: process.env.E2E_CUSTOMER_PASSWORD, portal: "admin" } })).status()).toBe(200);
    const setup = await context.request.post("/api/v1/auth/mfa/setup", { headers: { Origin: baseURL! } }); expect(setup.status()).toBe(200);
    expect((await context.request.post("/api/v1/auth/mfa/confirm", { headers: { Origin: baseURL! }, data: { code: code((await setup.json()).data.secret) } })).status()).toBe(200);
    const page = await context.newPage(); await page.goto("/admin/launch-readiness/setup");
    const guide = page.locator(".live-setup-page");
    await expect(guide.getByRole("heading", { name: "Set up DeshDak for live use." })).toBeVisible();
    if (info.project.name === "mobile") expect(await page.locator(".admin-menu-button").evaluate(el => getComputedStyle(el, "::after").content)).toContain("DeshDak Admin");
    await expect(guide.locator(".live-setup-card")).toHaveCount(13);
    await expect(guide.getByRole("region", { name: "Required live setup" }).locator("article")).toHaveCount(10);
    await expect(guide.getByRole("region", { name: "Optional integrations" }).locator("article")).toHaveCount(3);
    const incomplete = await guide.locator('.live-setup-configuration[data-state="required"]').count();
    await expect(guide.getByLabel("Areas missing configuration", { exact: true }).locator("b")).toHaveText(String(incomplete));
    await expect(guide).toContainText("These counts overlap; neither is a launch approval");
    await guide.getByText("Jump to a setup area", { exact: true }).click();
    const navigation = guide.getByRole("navigation", { name: "Setup areas" });
    await expect(navigation.getByRole("link")).toHaveCount(13);
    await navigation.getByRole("link", { name: "Phone verification and SMS Required", exact: true }).click();
    await expect(guide.locator("#phone h3")).toBeInViewport();
    await guide.getByText("Jump to a setup area", { exact: true }).click();
    const documents = guide.locator("#documents");
    await expect(documents).toContainText("Integration / certification required");
    await expect(documents).toContainText("Development database-backed upload switches must stay disabled");
    await expect(documents.locator(".live-setup-configuration")).toBeVisible();
    const media = guide.locator("#website-media");
    await expect(media).toContainText("Direct video-file upload and high-volume object storage remain engineering work");
    await expect(media.getByRole("link", { name: "Open Website Content Manager", exact: false })).toHaveAttribute("href", "/admin/website-content");
    const email = guide.locator("#email");
    await expect(email).toContainText("Integration / certification required");
    await expect(email).toContainText("A successful send request means accepted, not delivered");
    await email.getByText("Deployment variable names", { exact: false }).click();
    await expect(email.locator("code").filter({ hasText: /^RESEND_API_KEY$/ })).toBeVisible();
    await expect(guide.locator("form")).toHaveCount(0);
    await expect(guide.getByRole("link", { name: "Open launch evidence register", exact: true })).toHaveAttribute("href", "/admin/launch-readiness");
    for (const link of await guide.locator('a[href^="/admin/"]').all()) expect(await link.getAttribute("href")).toMatch(/^\/admin\//);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    expect(await guide.locator(".admin-intro").evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
    await info.attach(`live-setup-${info.project.name}`, { body: await page.screenshot(), contentType: "image/png" });
    const fallback = await browser.newContext({ baseURL, viewport, javaScriptEnabled: false, storageState: await context.storageState() });
    try {
      const noScript = await fallback.newPage(); await noScript.goto("/admin/launch-readiness/setup");
      await expect(noScript.locator(".live-setup-card:visible")).toHaveCount(13);
      // Without hydration, Suspense also retains hidden server content. Operate
      // the visible native details element, as a keyboard/pointer user would.
      const jump = noScript.locator(".live-setup-jump:visible");
      await jump.locator("summary").click();
      await expect(jump.getByRole("navigation", { name: "Setup areas" }).getByRole("link")).toHaveCount(13);
    }
    finally { await fallback.close(); }
    await email.getByRole("link", { name: "Open notification controls", exact: false }).click();
    await expect(page.getByRole("heading", { name: "Delivery and campaigns.", exact: true })).toBeVisible();
    const notifications = page.locator(".admin-notification-operations");
    await expect(notifications.getByRole("heading", { name: "Email accepted", exact: true })).toBeVisible();
    await expect(notifications).toContainText("Provider accepted; recipient delivery is unconfirmed.");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await info.attach(`notification-operations-${info.project.name}`, { body: await page.screenshot(), contentType: "image/png" });
    await page.getByRole("link", { name: /^Review blocked email addresses/ }).click();
    const record = page.locator(`#suppression-${admin.suppressionId}:visible`);
    await record.getByText("Review and release this address", { exact: true }).click();
    const reason = "Verified synthetic recipient correction with controlled evidence.";
    const evidence = "Synthetic support review reference 2026-11-05";
    await record.getByLabel("Review reason", { exact: true }).fill(reason);
    await record.getByLabel("Safe evidence reference", { exact: true }).fill(evidence);
    await record.getByRole("checkbox").check();
    const endpoint = `**/api/v1/admin/email-suppressions/${admin.suppressionId}/release`;
    await page.route(endpoint, route => route.abort());
    await record.getByRole("button", { name: "Record verified release", exact: true }).click();
    await expect(record.getByRole("alert")).toContainText("Review could not be confirmed");
    await expect(record.getByLabel("Review reason", { exact: true })).toHaveValue(reason);
    await expect(record.getByRole("button", { name: "Record verified release", exact: true })).toBeEnabled();
    await page.unroute(endpoint);
    await page.route(endpoint, route => route.fulfill({ status: 200, contentType: "application/json", body: '{"data":{}}' }));
    await record.getByRole("button", { name: "Record verified release", exact: true }).click();
    await expect(record.getByRole("alert")).toContainText("Review could not be confirmed");
    await expect(record.getByLabel("Safe evidence reference", { exact: true })).toHaveValue(evidence);
    await page.unroute(endpoint);
    const noJsReview = await browser.newContext({ baseURL, viewport, javaScriptEnabled: false, storageState: await context.storageState() });
    try {
      const noJsPage = await noJsReview.newPage(); await noJsPage.goto("/admin/notifications/email-suppressions");
      const noJsRecord = noJsPage.locator(`#suppression-${admin.suppressionId}:visible`);
      await noJsRecord.locator("summary").click();
      await expect(noJsRecord.getByRole("button", { name: "Record verified release", exact: true })).toBeDisabled();
    } finally { await noJsReview.close(); }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await info.attach(`email-suppression-review-${info.project.name}`, { body: await page.screenshot(), contentType: "image/png" });
    await record.getByRole("button", { name: "Record verified release", exact: true }).click();
    await expect(record).toHaveCount(0);
    await page.getByLabel("Show", { exact: true }).selectOption("released");
    await page.getByRole("button", { name: "Apply filter", exact: true }).click();
    await expect(record).toBeVisible();
    await expect(record.locator("form")).toHaveCount(0);

  } finally {
    expect((await context.request.post("/api/v1/auth/logout", { headers: { Origin: baseURL! } })).status()).toBe(200);
    await context.close();
  }
});
