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
test("support role grant and removal recovery", async ({ browser, baseURL }, info) => {
  test.skip(!process.env.E2E_SUPPORT_ROLE_ADMINS, "Requires dedicated isolated access fixtures.");
  test.setTimeout(90_000);
  const admin = (JSON.parse(process.env.E2E_SUPPORT_ROLE_ADMINS!) as Record<string, { email: string; agentId: string; agentEmail: string }>)[info.project.name];
  const viewport = info.project.name === "mobile" ? { width: 375, height: 812 } : { width: 1440, height: 1000 };
  const context = await browser.newContext({ baseURL, viewport, storageState: { cookies: [], origins: [] } });
  const agentContext = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  try {
    expect((await context.request.post("/api/v1/auth/login", { headers: { Origin: baseURL! }, data: { email: admin.email, password: process.env.E2E_CUSTOMER_PASSWORD, portal: "admin" } })).status()).toBe(200);
    const setup = await context.request.post("/api/v1/auth/mfa/setup", { headers: { Origin: baseURL! } }); expect(setup.status()).toBe(200);
    expect((await context.request.post("/api/v1/auth/mfa/confirm", { headers: { Origin: baseURL! }, data: { code: code((await setup.json()).data.secret) } })).status()).toBe(200);
    const page = await context.newPage(); await page.goto("/admin/support");
    const form = page.locator(".support-agent-form").filter({ visible: true });
    const input = form.getByRole("textbox"); const grant = form.getByRole("button", { name: "Grant Customer Service role", exact: true });
    await expect(grant).toBeEnabled(); await input.fill(admin.agentEmail);
    page.once("dialog", dialog => dialog.dismiss()); await grant.click();
    const agents = async () => (await (await context.request.get("/api/v1/admin/support-agents")).json()).data.agents as { id: string }[];
    expect((await agents()).some(agent => agent.id === admin.agentId)).toBe(false);
    page.on("dialog", dialog => dialog.accept());
    const grantPattern = "**/api/v1/admin/support-agents";
    for (const mode of ["abort", "json", "unconfirmed", "rejected"]) {
      await page.route(grantPattern, route => mode === "abort" ? route.abort("failed") : route.fulfill(mode === "json" ? { contentType: "application/json", body: "invalid JSON" } : mode === "rejected" ? { status: 422, json: { error: { message: "Synthetic access error" } } } : { json: { data: {} } }));
      await grant.click(); await expect(form.getByRole("alert")).toContainText(mode === "rejected" ? "Synthetic access error" : "Could not confirm the access change");
      await expect(grant).toBeEnabled(); await expect(input).toHaveValue(admin.agentEmail); await page.unroute(grantPattern);
    }
    let grants = 0;
    await page.route(grantPattern, async route => { grants++; await route.continue(); });
    await form.evaluate(element => { (element as HTMLFormElement).requestSubmit(); (element as HTMLFormElement).requestSubmit(); });
    await expect(form.getByRole("status")).toContainText("Customer Service access granted"); expect(grants).toBe(1); await expect(input).toHaveValue(""); await page.unroute(grantPattern);
    const row = page.locator(".support-agent-row").filter({ hasText: admin.agentEmail, visible: true });
    const remove = row.getByRole("button", { name: "Remove", exact: true }); await expect(remove).toBeEnabled();
    const noScript = await browser.newContext({ baseURL, viewport, javaScriptEnabled: false, storageState: await context.storageState() });
    try {
      const fallback = await noScript.newPage(); await fallback.goto("/admin/support");
      const fallbackForm = fallback.locator(".support-agent-form").filter({ visible: true });
      await expect(fallbackForm).toHaveAttribute("method", "post");
      for (const control of await fallbackForm.locator("input,button").all()) await expect(control).toBeDisabled();
      await expect(fallback.locator(".support-agent-row").filter({ hasText: admin.agentEmail, visible: true }).getByRole("button", { name: "Remove", exact: true })).toBeDisabled();
    } finally { await noScript.close(); }
    page.removeAllListeners("dialog"); page.once("dialog", dialog => dialog.dismiss()); await remove.click();
    expect((await agents()).some(agent => agent.id === admin.agentId)).toBe(true);
    page.on("dialog", dialog => dialog.accept());
    expect((await agentContext.request.post("/api/v1/auth/login", { headers: { Origin: baseURL! }, data: { email: admin.agentEmail, password: process.env.E2E_CUSTOMER_PASSWORD, portal: "support" } })).status()).toBe(200);
    const pattern = `**/api/v1/admin/support-agents/${admin.agentId}`;
    for (const mode of ["abort", "json", "unconfirmed", "rejected"]) {
      await page.route(pattern, route => mode === "abort" ? route.abort("failed") : route.fulfill(mode === "json" ? { contentType: "application/json", body: "invalid JSON" } : mode === "rejected" ? { status: 409, json: { error: { message: "Synthetic active-ticket guard" } } } : { json: { data: {} } }));
      await remove.click(); await expect(row.getByRole("alert")).toContainText(mode === "rejected" ? "Synthetic active-ticket guard" : "Could not confirm removal");
      await expect(remove).toBeEnabled(); await page.unroute(pattern);
    }
    let removals = 0;
    await page.route(pattern, async route => { removals++; expect((await route.fetch()).status()).toBe(200); await route.abort("failed"); });
    await remove.evaluate(element => { (element as HTMLButtonElement).click(); (element as HTMLButtonElement).click(); });
    await expect(row.getByRole("alert")).toContainText("Could not confirm removal"); expect(removals).toBe(1);
    await page.unroute(pattern); expect((await agents()).some(agent => agent.id === admin.agentId)).toBe(false);
    expect((await agentContext.request.get("/api/v1/support/tickets")).status()).toBe(403);
    await page.reload(); await expect(row).toHaveCount(0);
  } finally {
    expect((await context.request.post("/api/v1/auth/logout", { headers: { Origin: baseURL! } })).status()).toBe(200);
    await agentContext.close(); await context.close();
  }
});
