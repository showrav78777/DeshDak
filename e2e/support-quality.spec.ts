import { createHmac } from "node:crypto";
import { test, expect } from "./fixtures";

function code(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret].map(character => alphabet.indexOf(character).toString(2).padStart(5, "0")).join("");
  const bytes = []; for (let offset = 0; offset + 8 <= bits.length; offset += 8) bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest(); const offset = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}
test.use({ trace: "off", screenshot: "off", actionTimeout: 10_000 });
test.describe.configure({ retries: 0 });
test("support quality review recovery and stale-save protection", async ({ browser, baseURL }, info) => {
  test.skip(!process.env.E2E_QUALITY_REVIEW_ADMINS, "Requires dedicated isolated Admin fixtures.");
  test.setTimeout(90_000);
  const admin = (JSON.parse(process.env.E2E_QUALITY_REVIEW_ADMINS!) as Record<string, { email: string; ticketId: string; reference: string }>)[info.project.name];
  const viewport = info.project.name === "mobile" ? { width: 375, height: 812 } : { width: 1440, height: 1000 };
  const context = await browser.newContext({ baseURL, viewport, storageState: { cookies: [], origins: [] } });
  const staff = await browser.newContext({ baseURL, storageState: "e2e/.auth/support.json" });
  const customer = await browser.newContext({ baseURL, storageState: "e2e/.auth/customer.json" });
  try {
    expect((await context.request.post("/api/v1/auth/login", { headers: { Origin: baseURL! }, data: { email: admin.email, password: process.env.E2E_CUSTOMER_PASSWORD, portal: "admin" } })).status()).toBe(200);
    expect((await context.request.get("/api/v1/admin/users")).status()).toBe(403);
    const setup = await context.request.post("/api/v1/auth/mfa/setup", { headers: { Origin: baseURL! } }); expect(setup.status()).toBe(200);
    expect((await context.request.post("/api/v1/auth/mfa/confirm", { headers: { Origin: baseURL! }, data: { code: code((await setup.json()).data.secret) } })).status()).toBe(200);
    const path = `/admin/support/${admin.ticketId}`;
    const page = await context.newPage(); await page.goto(path);
    const form = page.locator(".support-quality-form").filter({ visible: true });
    const button = form.getByRole("button", { name: /quality review$/ });
    await expect(button).toBeEnabled();
    const review = page.locator(".support-admin-review").filter({ visible: true });
    await expect(review.locator(".support-quality-form")).toBeVisible();
    expect(await review.evaluate(element => element.closest("aside") === null)).toBe(true);
    expect(await review.evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(info.project.name === "mobile" ? 240 : 500);
    expect(await form.locator("select").first().evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
    expect(await button.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    const noScript = await browser.newContext({ baseURL, viewport, javaScriptEnabled: false, storageState: await context.storageState() });
    try {
      const fallback = await noScript.newPage(); await fallback.goto(path);
      const disabledForm = fallback.locator(".support-quality-form").filter({ visible: true });
      await expect(disabledForm).toHaveAttribute("method", "post");
      for (const control of await disabledForm.locator("select,textarea,button").all()) await expect(control).toBeDisabled();
    } finally { await noScript.close(); }
    await form.getByRole("combobox", { name: "Quality score", exact: true }).selectOption("2");
    await form.getByRole("combobox", { name: "Outcome", exact: true }).selectOption("COACHING_REQUIRED");
    const summary = form.getByRole("textbox", { name: "Review summary", exact: true });
    const coaching = form.locator("textarea[name=coachingAction]");
    await summary.fill("Synthetic initial quality review requiring coaching.");
    expect(await form.evaluate(element => (element as HTMLFormElement).checkValidity())).toBe(false);
    await coaching.fill("Synthetic coaching action for response clarity.");
    const pattern = `**/api/v1/admin/support-quality-reviews/${admin.ticketId}`;
    for (const mode of ["abort", "json", "unconfirmed", "rejected"]) {
      await page.route(pattern, route => mode === "abort" ? route.abort("failed") : route.fulfill(mode === "json" ? { contentType: "application/json", body: "invalid JSON" } : mode === "rejected" ? { status: 422, json: { error: { message: "Synthetic validation error" } } } : { json: { data: {} } }));
      await button.click(); await expect(form.getByRole("alert")).toContainText(mode === "rejected" ? "Synthetic validation error" : "Could not confirm the quality review");
      await expect(button).toBeEnabled(); await expect(coaching).toHaveValue("Synthetic coaching action for response clarity.");
      await page.unroute(pattern);
    }
    let commits = 0;
    await page.route(pattern, async route => { commits++; expect((await route.fetch()).status()).toBe(200); await route.abort("failed"); });
    await form.evaluate(element => { (element as HTMLFormElement).requestSubmit(); (element as HTMLFormElement).requestSubmit(); });
    await expect(form.getByRole("alert")).toContainText("Could not confirm the quality review"); expect(commits).toBe(1);
    await page.unroute(pattern); await button.click();
    await expect(form.getByRole("alert")).toContainText("changed after the page loaded");
    await page.reload(); await expect(form.getByRole("combobox", { name: "Quality score", exact: true })).toHaveValue("2");
    await form.getByRole("combobox", { name: "Quality score", exact: true }).selectOption("4");
    await form.getByRole("combobox", { name: "Outcome", exact: true }).selectOption("PASS");
    await summary.fill("Synthetic revised quality review after coaching."); await coaching.fill("   ");
    await button.click(); await expect(form.getByRole("status")).toHaveText("Quality review saved."); await expect(button).toBeEnabled();
    await expect(async () => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1)).toPass({ timeout: 10_000 });
    await review.scrollIntoViewIfNeeded();
    await info.attach(`quality-${info.project.name}`, { body: await page.screenshot(), contentType: "image/png" });
    const payload = { score: 5, outcome: "PASS", summary: "Must not overwrite the existing review.", coachingAction: null, version: 1 };
    expect((await context.request.put(`/api/v1/admin/support-quality-reviews/${admin.ticketId}`, { headers: { Origin: baseURL! }, data: payload })).status()).toBe(409);
    expect((await staff.request.put(`/api/v1/admin/support-quality-reviews/${admin.ticketId}`, { headers: { Origin: baseURL! }, data: payload })).status()).toBe(403);
    const agentPage = await staff.request.get(`/support/tickets/${admin.reference}`); expect(agentPage.status()).toBe(200);
    expect(await agentPage.text()).toContain("Synthetic revised quality review after coaching.");
    const customerPage = await customer.request.get(`/support/${admin.ticketId}`); expect(customerPage.status()).toBe(200);
    expect(await customerPage.text()).not.toContain("Synthetic revised quality review after coaching.");
  } finally {
    expect((await context.request.post("/api/v1/auth/logout", { headers: { Origin: baseURL! } })).status()).toBe(200);
    await context.close(); await staff.close(); await customer.close();
  }
});
