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
test("sourcing review decision recovery", async ({ browser, baseURL }, info) => {
  test.skip(!process.env.E2E_SOURCING_REVIEWS, "Requires isolated review fixtures."); test.setTimeout(120_000);
  const fixtures = JSON.parse(process.env.E2E_SOURCING_REVIEWS!)[info.project.name];
  const admin = JSON.parse(process.env.E2E_SOURCING_DECISION_ADMINS!)[info.project.name];
  const context = await browser.newContext({ baseURL, viewport: info.project.name === "mobile" ? { width: 375, height: 812 } : { width: 1440, height: 1000 }, storageState: { cookies: [], origins: [] } });
  try {
    expect((await context.request.post("/api/v1/auth/login", { headers: { Origin: baseURL! }, data: { email: admin.email, password: process.env.E2E_CUSTOMER_PASSWORD, portal: "admin" } })).status()).toBe(200);
    const setup = await context.request.post("/api/v1/auth/mfa/setup", { headers: { Origin: baseURL! } }); expect(setup.status()).toBe(200);
    expect((await context.request.post("/api/v1/auth/mfa/confirm", { headers: { Origin: baseURL! }, data: { code: code((await setup.json()).data.secret) } })).status()).toBe(200);
    const page = await context.newPage(); await page.goto("/admin/sourcing");
    for (const action of ["APPROVE", "REJECT"]) {
      const fixture = fixtures[action]; const path = `/api/v1/admin/sourcing-quotes/${fixture.quoteId}/review`;
      const card = page.locator(".sourcing-card").filter({ hasText: fixture.reference, visible: true }); const form = card.locator(".sourcing-review-form");
      const note = form.getByRole("textbox", { name: "Admin review note" });
      await note.fill(`Synthetic verified review ${info.project.name} ${action}`);
      const button = form.getByRole("button", { name: action === "APPROVE" ? "Approve and send" : "Reject draft", exact: true });
      if (action === "APPROVE") {
        for (const mode of ["abort", "json", "unconfirmed", "wrong-state", "conflict"]) {
          await page.route(`**${path}`, async route => {
            if (mode === "abort") await route.abort();
            else if (mode === "json") await route.fulfill({ status: 200, body: "invalid" });
            else await route.fulfill({ status: mode === "conflict" ? 409 : 200, json: mode === "conflict" ? { error: { message: "Synthetic stale review" } } : { data: { quote: { id: mode === "unconfirmed" ? "wrong" : fixture.quoteId, status: "REJECTED", reviewedById: admin.id, reviewedAt: new Date().toISOString() } } } });
          });
          await button.click(); await expect(form.getByRole("alert")).toBeVisible(); await expect(button).toBeEnabled();
          await expect(note).toHaveValue(`Synthetic verified review ${info.project.name} ${action}`);
          await page.unroute(`**${path}`);
        }
        await info.attach(`sourcing-review-${info.project.name}`, { body: await page.screenshot(), contentType: "image/png" });
      }
      let commits = 0;
      await page.route(`**${path}`, async route => {
        commits++; const response = await route.fetch(); expect(response.status()).toBe(200);
        expect((await response.json()).data.quote.status).toBe(action === "APPROVE" ? "SENT" : "REJECTED");
        if (action === "APPROVE") await route.abort(); else await route.fulfill({ response });
      });
      await form.evaluate((element: HTMLFormElement, selectedAction) => { const submitter = element.querySelector<HTMLButtonElement>(`button[value="${selectedAction}"]`)!; element.requestSubmit(submitter); element.requestSubmit(submitter); }, action);
      if (action === "APPROVE") {
        await expect(form.getByRole("alert")).toContainText("decision may already have saved");
        expect(commits).toBe(1); await page.unroute(`**${path}`);
        const replay = await context.request.patch(path, { headers: { Origin: baseURL! }, data: { action, note: "Do not apply again" } }); expect(replay.status()).toBe(409);
        await form.getByRole("button", { name: "Refresh review queue" }).click();
      }
      if (action === "APPROVE") await expect(card).toHaveCount(0);
      else { await expect(form).toHaveCount(0); await expect(card).toContainText("Awaiting a Sourcing Agent draft"); }
      expect(commits).toBe(1); await page.unroute(`**${path}`);
    }
  } finally {
    expect((await context.request.post("/api/v1/auth/logout", { headers: { Origin: baseURL! } })).status()).toBe(200);
    await context.close();
  }
});
