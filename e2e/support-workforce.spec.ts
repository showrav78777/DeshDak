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
test("support workforce settings recovery and version protection", async ({ browser, baseURL }, info) => {
  test.skip(!process.env.E2E_SUPPORT_REVIEW_ADMINS, "Requires dedicated isolated Admin fixtures.");
  test.setTimeout(90_000);
  const admin = (JSON.parse(process.env.E2E_SUPPORT_REVIEW_ADMINS!) as Record<string, { email: string; agentId: string; agentEmail: string }>)[info.project.name];
  const viewport = info.project.name === "mobile" ? { width: 375, height: 812 } : { width: 1440, height: 1000 };
  const context = await browser.newContext({ baseURL, viewport, storageState: { cookies: [], origins: [] } });
  try {
    expect((await context.request.post("/api/v1/auth/login", { headers: { Origin: baseURL! }, data: { email: admin.email, password: process.env.E2E_CUSTOMER_PASSWORD, portal: "admin" } })).status()).toBe(200);
    expect((await context.request.get("/api/v1/admin/users")).status()).toBe(403);
    const setup = await context.request.post("/api/v1/auth/mfa/setup", { headers: { Origin: baseURL! } }); expect(setup.status()).toBe(200);
    expect((await context.request.post("/api/v1/auth/mfa/confirm", { headers: { Origin: baseURL! }, data: { code: code((await setup.json()).data.secret) } })).status()).toBe(200);
    const page = await context.newPage(); await page.goto("/admin/support");
    const row = page.locator(".support-agent-row").filter({ hasText: admin.agentEmail, visible: true });
    const details = row.locator(".support-agent-profile"); const form = details.locator("form");
    await expect(details).toHaveJSProperty("inert", false);
    await details.locator("summary").click();
    const button = form.getByRole("button", { name: "Save workforce settings", exact: true });
    await expect(button).toBeVisible(); await expect(button).toBeEnabled();
    await expect(page.getByRole("complementary", { name: "Support operations steps" }).filter({ visible: true })).toBeVisible();
    expect(await page.locator(".support-admin-grid").filter({ visible: true }).evaluate(element => element.lastElementChild?.classList.contains("support-workforce-panel"))).toBe(true);
    expect(await row.evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(info.project.name === "mobile" ? 240 : 400);
    expect(await form.locator("select").first().evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
    expect(await button.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    const noScript = await browser.newContext({ baseURL, viewport, javaScriptEnabled: false, storageState: await context.storageState() });
    try {
      const fallback = await noScript.newPage(); await fallback.goto("/admin/support");
      const disclosure = fallback.locator(".support-agent-row").filter({ hasText: admin.agentEmail, visible: true }).locator(".support-agent-profile");
      await expect(disclosure).toHaveAttribute("inert", ""); await expect(disclosure.locator("form")).toHaveAttribute("method", "post");
      for (const control of await disclosure.locator("input,select,button").all()) await expect(control).toBeDisabled();
    } finally { await noScript.close(); }
    const availability = form.getByRole("combobox", { name: "Status", exact: true });
    await expect(availability).toHaveAccessibleName("Status");
    await availability.selectOption("BUSY");
    await form.getByLabel("Maximum active tickets").fill("3");
    await form.getByLabel("Languages", { exact: true }).fill("en, bn, en");
    await form.getByLabel("Status note", { exact: true }).fill("Synthetic workforce recovery review.");
    const pattern = `**/api/v1/admin/support-agents/${admin.agentId}/profile`;
    for (const mode of ["abort", "json", "unconfirmed", "rejected"]) {
      await page.route(pattern, route => mode === "abort" ? route.abort("failed") : route.fulfill(mode === "json" ? { contentType: "application/json", body: "invalid JSON" } : mode === "rejected" ? { status: 422, json: { error: { message: "Synthetic validation error" } } } : { json: { data: {} } }));
      await button.click(); await expect(form.getByRole("alert")).toContainText(mode === "rejected" ? "Synthetic validation error" : "Could not confirm workforce settings");
      await expect(button).toBeEnabled(); await expect(form.getByLabel("Maximum active tickets")).toHaveValue("3");
      await page.unroute(pattern);
    }
    let commits = 0;
    await page.route(pattern, async route => { commits++; expect((await route.fetch()).status()).toBe(200); await route.abort("failed"); });
    await form.evaluate(element => { (element as HTMLFormElement).requestSubmit(); (element as HTMLFormElement).requestSubmit(); });
    await expect(form.getByRole("alert")).toContainText("Could not confirm workforce settings"); expect(commits).toBe(1);
    await page.unroute(pattern); await button.click();
    await expect(form.getByRole("alert")).toContainText("changed after the page loaded");
    await page.reload(); await details.locator("summary").click();
    await expect(availability).toHaveValue("BUSY");
    await expect(form.getByLabel("Maximum active tickets")).toHaveValue("3");
    await availability.selectOption("OFFLINE");
    await form.getByLabel("Maximum active tickets").fill("4");
    await form.getByLabel("Status note", { exact: true }).fill("   ");
    await button.click(); await expect(form.getByRole("status")).toHaveText("Workforce settings saved.");
    await expect(button).toBeEnabled();
    await expect(async () => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1)).toPass({ timeout: 10_000 });
    await row.scrollIntoViewIfNeeded();
    await info.attach(`workforce-${info.project.name}`, { body: await page.screenshot(), contentType: "image/png" });
    expect((await context.request.put(`/api/v1/admin/support-agents/${admin.agentId}/profile`, { headers: { Origin: "https://untrusted.example.test" }, data: {} })).status()).toBe(403);
  } finally {
    expect((await context.request.post("/api/v1/auth/logout", { headers: { Origin: baseURL! } })).status()).toBe(200);
    await context.close();
  }
});
