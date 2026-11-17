import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

// Account-review contexts represent a separate synthetic client. Keep their
// login budget independent of unrelated portal tests, using the existing local
// development ingress path only inside a generated disposable schema.
const accountClientHeaders: Record<string, string> = /^crossly_launch_verify_[a-f0-9]{16}$/.test(
  new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unused").searchParams.get("schema") ?? "",
) ? { "x-forwarded-for": "198.18.0.20" } : {};

const fixture = () => JSON.parse(process.env.E2E_ACCOUNT_REVIEW!) as { orderId: string; orderNumber: string; foreignOrderId: string; foreignOrderNumber: string; emptyEmail: string };
async function fits(page: Page) {
  await expect(async () => {
    const layout = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth, overflow: [...document.querySelectorAll("body *")].map(element => { const rect = element.getBoundingClientRect(); return { tag: element.tagName, className: element.className.toString(), right: rect.right, width: rect.width }; }).filter(item => item.right > innerWidth + 1).slice(-12) }));
    expect(layout.width, JSON.stringify(layout)).toBeLessThanOrEqual(layout.viewport + 1);
  }).toPass({ timeout: 10_000 });
}

test.describe("customer account review", () => {
  test.use({ extraHTTPHeaders: accountClientHeaders });
  test.describe.configure({ mode: "serial", retries: 0 });
  for (const [name, viewport] of [["desktop", { width: 1440, height: 1000 }], ["mobile", { width: 375, height: 812 }]] as const) {
    test(`${name}: dashboard privacy recovery and complete order quantity`, async ({ page, request, baseURL, browser }) => {
      test.skip(!process.env.E2E_ACCOUNT_REVIEW, "Requires isolated account fixtures.");
      test.setTimeout(90_000);
      const data = fixture();
      await page.setViewportSize(viewport);
      const privacy = "/api/v1/users/me/privacy";
      const original = (await (await request.get(privacy)).json()).data.privacy.analyticsConsent as boolean;
      try {
        await page.goto("/dashboard");
        await expect(page.getByRole("heading", { name: /Welcome back/ })).toBeVisible();
        const control = page.locator(".privacy-control");
        const checkbox = control.getByRole("checkbox", { name: "Allow optional shopping analytics" });
        await expect(checkbox).toHaveJSProperty("checked", original);
        await page.route(`**${privacy}`, route => route.abort("failed"));
        await checkbox.click();
        await expect(control.getByRole("alert")).toContainText("Could not confirm");
        await expect(checkbox).toBeEnabled();
        await expect(checkbox).toHaveJSProperty("checked", original);
        await page.unroute(`**${privacy}`);
        await page.route(`**${privacy}`, route => route.fulfill({ contentType: "application/json", body: "invalid JSON" }));
        await checkbox.click();
        await expect(control.getByRole("alert")).toContainText("Could not confirm");
        await expect(checkbox).toBeEnabled();
        await page.unroute(`**${privacy}`);
        await checkbox.click();
        await expect(control.getByRole("status")).toHaveText("Privacy setting saved.");
        expect((await (await request.get(privacy)).json()).data.privacy.analyticsConsent).toBe(!original);
        expect((await request.patch(privacy, { headers: { Origin: "https://untrusted.example.test" }, data: { analyticsConsent: original } })).status()).toBe(403);
        await page.reload();
        await expect(checkbox).toHaveJSProperty("checked", !original);
        await fits(page);
        await test.info().attach(`dashboard-${name}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
        const noScript = await browser.newContext({ baseURL, extraHTTPHeaders: accountClientHeaders, viewport, javaScriptEnabled: false, storageState: "e2e/.auth/customer.json" });
        try {
          const fallback = await noScript.newPage();
          await fallback.goto("/dashboard");
          await expect(fallback.getByRole("checkbox", { name: "Allow optional shopping analytics" })).toBeDisabled();
          await fallback.goto(`/orders/${data.orderId}`);
          await expect(fallback.getByRole("button", { name: "Submit for review" })).toHaveCount(2);
          for (const button of await fallback.getByRole("button", { name: "Submit for review" }).all()) await expect(button).toBeDisabled();
          await expect(fallback.locator(".rma-form").first()).toHaveAttribute("method", "post");
        } finally { await noScript.close(); }
        await page.goto("/orders");
        const card = page.locator(".order-card").filter({ hasText: data.orderNumber, visible: true });
        await expect(card).toHaveCount(1);
        await expect(card.locator(".order-meta")).toContainText("6 items");
        await expect(page.locator(".orders-list").filter({ visible: true })).not.toContainText(data.foreignOrderNumber);
        await fits(page);
        await test.info().attach(`orders-${name}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
        await card.getByRole("link", { name: "Open order timeline" }).click();
        await expect(page).toHaveURL(new RegExp(`/orders/${data.orderId}$`));
        await expect(page.locator(".order-product-list h3")).toHaveCount(3);
        await fits(page);
        const claims = JSON.parse(process.env.E2E_CLAIM_REVIEW!) as { status: string; deadline: string; shipmentId: string; trackingNumber: string; packageId: string }[];
        const section = page.locator(".rma-order-card");
        await expect(section.locator(".rma-form")).toHaveCount(2);
        for (const claim of claims.filter(claim => claim.deadline === "open" && claim.status !== "IN_TRANSIT")) {
          await expect(section.locator(".rma-form").filter({ hasText: claim.trackingNumber })).toBeVisible();
        }
        await expect(section.locator(".rma-existing").filter({ hasText: "Claims open after" })).toHaveCount(2);
        for (const claim of claims.filter(claim => claim.deadline === "expired")) {
          await expect(section.locator(".rma-existing").filter({ hasText: claim.trackingNumber })).toContainText("claim window");
          const rejected = await request.post("/api/v1/rmas", { headers: { Origin: baseURL!, "Idempotency-Key": crypto.randomUUID() }, data: { shipmentId: claim.shipmentId, packageIds: [claim.packageId], reason: "DAMAGED", description: "Synthetic expired claim regression only", evidenceReferences: ["rma-evidence/synthetic-test.jpg"] } });
          expect(rejected.status()).toBe(422);
          expect((await rejected.json()).error.code).toBe("CLAIM_WINDOW_EXPIRED");
        }
        const claimForm = section.locator(".rma-form").first();
        await claimForm.getByLabel("Detailed description").fill("Synthetic claim recovery test, no real submission");
        await claimForm.getByLabel("Private evidence reference").fill("rma-evidence/synthetic-test.jpg");
        const keys: string[] = [];
        let responseMode = "abort";
        let releaseResponse: (() => void) | undefined;
        const responseHeld = new Promise<void>(resolve => { releaseResponse = resolve; });
        await page.route("**/api/v1/rmas", async route => {
          keys.push(route.request().headers()["idempotency-key"]);
          if (responseMode === "abort") return route.abort("failed");
          if (responseMode === "json") return route.fulfill({ contentType: "application/json", body: "invalid JSON" });
          if (responseMode === "unconfirmed") return route.fulfill({ json: { data: { rma: { id: "https://untrusted.example.test" } } } });
          if (responseMode === "pending") await responseHeld;
          return route.fulfill({ status: 422, json: { error: { message: "Synthetic claim validation rejection" } } });
        });
        for (responseMode of ["abort", "json", "unconfirmed"]) {
          await claimForm.getByRole("button", { name: "Submit for review" }).click();
          await expect(claimForm.getByRole("alert")).toContainText("Could not confirm submission");
          await expect(claimForm.getByRole("button", { name: "Submit for review" })).toBeEnabled();
          await expect(claimForm.getByLabel("Detailed description")).toHaveValue("Synthetic claim recovery test, no real submission");
        }
        expect(keys).toHaveLength(3);
        expect(new Set(keys).size).toBe(1);
        expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/i);
        await expect(page).toHaveURL(new RegExp(`/orders/${data.orderId}$`));
        responseMode = "rejected";
        await claimForm.getByLabel("Detailed description").fill("Synthetic changed claim recovery details");
        await claimForm.getByRole("button", { name: "Submit for review" }).click();
        await expect(claimForm.getByRole("alert")).toHaveText("Synthetic claim validation rejection");
        expect(keys[3]).not.toBe(keys[0]);
        responseMode = "pending";
        await claimForm.getByRole("button", { name: "Submit for review" }).click();
        await expect(claimForm.getByRole("button", { name: "Submitting…" })).toBeDisabled();
        await claimForm.dispatchEvent("submit");
        await claimForm.dispatchEvent("submit");
        releaseResponse!();
        await expect(claimForm.getByRole("alert")).toHaveText("Synthetic claim validation rejection");
        expect(keys).toHaveLength(5);
        expect(keys[4]).toBe(keys[3]);
        await page.unroute("**/api/v1/rmas");
        expect((await page.goto(`/orders/${data.foreignOrderId}`))?.status()).toBe(404);
        expect((await request.get(`/api/v1/orders/${data.foreignOrderId}/timeline`)).status()).toBe(404);
      } finally {
        const restored = await request.patch(privacy, { headers: { Origin: baseURL! }, data: { analyticsConsent: original } });
        expect(restored.status()).toBe(200);
      }
    });

    test(`${name}: empty dashboard and orders give usable next steps`, async ({ browser, baseURL }) => {
      test.skip(!process.env.E2E_ACCOUNT_REVIEW, "Requires isolated account fixtures.");
      test.setTimeout(60_000);
      const context = await browser.newContext({ baseURL, extraHTTPHeaders: accountClientHeaders, viewport });
      try {
        const login = await context.request.post("/api/v1/auth/login", { headers: { Origin: baseURL! }, data: { email: fixture().emptyEmail, password: process.env.E2E_CUSTOMER_PASSWORD, portal: "customer" } });
        expect(login.status()).toBe(200);
        const page = await context.newPage();
        await page.goto("/dashboard");
        await expect(page.locator(".dashboard-empty")).toContainText("No orders yet");
        await expect(page.locator(".dashboard-empty").getByRole("link", { name: "Browse products" })).toHaveAttribute("href", "/products");
        await fits(page);
        await page.goto("/orders");
        await expect(page.getByRole("heading", { name: "No orders yet" })).toBeVisible();
        await expect(page.locator(".orders-empty").getByRole("link", { name: "Buy & Ship" })).toHaveAttribute("href", "/buy-ship");
        await fits(page);
      } finally {
        expect((await context.request.post("/api/v1/auth/logout", { headers: { Origin: baseURL! } })).status()).toBe(200);
        await context.close();
      }
    });

    test(`${name}: claim message and return tracking recover and save once`, async ({ page, request, browser, baseURL }) => {
      test.skip(!process.env.E2E_CLAIM_DETAILS, "Requires isolated claim fixtures.");
      test.setTimeout(90_000);
      await page.setViewportSize(viewport);
      const id = (JSON.parse(process.env.E2E_CLAIM_DETAILS!) as Record<string, string>)[name];
      const path = `/rmas/${id}`;
      const api = `/api/v1/rmas/${id}`;
      const noScript = await browser.newContext({ baseURL, extraHTTPHeaders: accountClientHeaders, viewport, javaScriptEnabled: false, storageState: "e2e/.auth/customer.json" });
      try {
        const fallback = await noScript.newPage();
        await fallback.goto(path);
        for (const label of ["Send update", "Confirm return shipment"]) await expect(fallback.getByRole("button", { name: label })).toBeDisabled();
        await expect(fallback.locator("form.rma-form").first()).toHaveAttribute("method", "post");
      } finally { await noScript.close(); }
      await page.goto(path);
      await fits(page);
      for (const config of [{ label: "Message", value: `Synthetic ${name} claim message`, button: "Send update", suffix: "messages", pending: "Sending…" }, { label: "Return tracking number", value: `RET-${name}-TEST`, button: "Confirm return shipment", suffix: "return", pending: "Saving…" }]) {
        const form = page.locator("form").filter({ has: page.getByLabel(config.label, { exact: true }) });
        await form.getByLabel(config.label, { exact: true }).fill(config.value);
        let mode = "abort";
        let calls = 0;
        let release: (() => void) | undefined;
        const held = new Promise<void>(resolve => { release = resolve; });
        await page.route(`**${api}/${config.suffix}`, async route => {
          calls++;
          if (mode === "abort") return route.abort("failed");
          if (mode === "json") return route.fulfill({ contentType: "application/json", body: "invalid JSON" });
          if (mode === "unconfirmed") return route.fulfill({ json: { data: {} } });
          if (mode === "pending") await held;
          return route.fulfill({ status: 409, json: { error: { message: "Synthetic update conflict" } } });
        });
        for (mode of ["abort", "json", "unconfirmed"]) {
          await form.getByRole("button", { name: config.button, exact: true }).click();
          await expect(form.getByRole("alert")).toContainText("Could not confirm this update");
          await expect(form.getByLabel(config.label, { exact: true })).toHaveValue(config.value);
          await expect(form.getByRole("button", { name: config.button, exact: true })).toBeEnabled();
        }
        mode = "pending";
        await form.getByRole("button", { name: config.button, exact: true }).click();
        await expect(form.getByRole("button", { name: config.pending, exact: true })).toBeDisabled();
        await form.dispatchEvent("submit");
        await form.dispatchEvent("submit");
        release!();
        await expect(form.getByRole("alert")).toHaveText("Synthetic update conflict");
        expect(calls).toBe(4);
        await page.unroute(`**${api}/${config.suffix}`);
        expect((await request.post(`${api}/${config.suffix}`, { headers: { Origin: "https://untrusted.example.test" }, data: {} })).status()).toBe(403);
        const saved = page.waitForResponse(response => response.url().endsWith(`${api}/${config.suffix}`) && response.request().method() === "POST");
        await form.getByRole("button", { name: config.button, exact: true }).click();
        expect((await saved).status()).toBe(config.suffix === "messages" ? 201 : 200);
        if (config.suffix === "messages") await expect(page.locator(".rma-messages")).toContainText(config.value);
        else await expect(page.getByRole("button", { name: config.button, exact: true })).toHaveCount(0);
      }
      await page.reload();
      const persisted = (await (await request.get(api)).json()).data.rma;
      expect(persisted.messages).toHaveLength(1);
      expect(persisted.returnTrackingNumber).toBe(`RET-${name}-TEST`);
      expect(persisted.status).toBe("RETURN_IN_TRANSIT");
      await fits(page);
      const foreign = await browser.newContext({ baseURL, extraHTTPHeaders: accountClientHeaders, storageState: { cookies: [], origins: [] } });
      try {
        for (const [suffix, data] of [["messages", { body: "Synthetic foreign message" }], ["return", { trackingNumber: "RET-FOREIGN-TEST" }]] as const) {
          expect((await foreign.request.post(`${api}/${suffix}`, { headers: { Origin: baseURL! }, data })).status()).toBe(401);
        }
        const login = await foreign.request.post("/api/v1/auth/login", { headers: { Origin: baseURL! }, data: { email: fixture().emptyEmail, password: process.env.E2E_CUSTOMER_PASSWORD, portal: "customer" } });
        expect(login.status()).toBe(200);
        expect((await foreign.request.get(api)).status()).toBe(404);
        for (const [suffix, data] of [["messages", { body: "Synthetic foreign message" }], ["return", { trackingNumber: "RET-FOREIGN-TEST" }]] as const) {
          expect((await foreign.request.post(`${api}/${suffix}`, { headers: { Origin: baseURL! }, data })).status()).toBe(404);
        }
      } finally {
        expect((await foreign.request.post("/api/v1/auth/logout", { headers: { Origin: baseURL! } })).status()).toBe(200);
        await foreign.close();
      }
    });
  }

  for (const [name, viewport] of [["desktop", { width: 1440, height: 1000 }], ["mobile", { width: 375, height: 812 }]] as const) {
    test(`customer account review ${name}: session sign-out recovery and current browser protection`, async ({ browser, baseURL, request }) => {
      test.skip(!process.env.E2E_ACCOUNT_REVIEW, "Requires isolated account fixtures.");
      test.setTimeout(90_000);
      const contexts = await Promise.all(["Safari/605 Macintosh", "Firefox/100 Linux", "Chrome/120 Windows"].map(userAgent => browser.newContext({ baseURL, extraHTTPHeaders: accountClientHeaders, viewport, userAgent, storageState: { cookies: [], origins: [] } })));
      const [current, target, remaining] = contexts;
      try {
        for (const context of contexts) expect((await context.request.post("/api/v1/auth/login", { headers: { Origin: baseURL! }, data: { email: fixture().emptyEmail, password: process.env.E2E_CUSTOMER_PASSWORD, portal: "customer" } })).status()).toBe(200);
        const page = await current.newPage();
        await page.goto("/security/sessions");
        await expect(page.getByRole("heading", { name: "Devices and sessions." })).toBeVisible();
        const row = page.locator(".session-list article").filter({ has: page.getByRole("heading", { name: "Mozilla Firefox on Linux" }) }).filter({ has: page.locator("em.active") });
        const all = page.getByRole("button", { name: "Sign out all other sessions", exact: true });
        const noScript = await browser.newContext({ baseURL, extraHTTPHeaders: accountClientHeaders, viewport, javaScriptEnabled: false, storageState: await current.storageState() });
        try {
          const fallback = await noScript.newPage(); await fallback.goto("/security/sessions");
          for (const button of await fallback.getByRole("button", { name: /^Sign out/ }).all()) await expect(button).toBeDisabled();
        } finally { await noScript.close(); }
        const singlePattern = "**/api/v1/auth/sessions/*";
        for (const mode of ["abort", "json", "unconfirmed"]) {
          await page.route(singlePattern, route => mode === "abort" ? route.abort("failed") : route.fulfill(mode === "json" ? { contentType: "application/json", body: "invalid JSON" } : { json: { data: {} } }));
          await row.getByRole("button", { name: "Sign out", exact: true }).click();
          await expect(page.locator(".session-security-page").getByRole("alert")).toContainText("Could not confirm sign-out");
          await expect(row.getByRole("button", { name: "Sign out", exact: true })).toBeEnabled();
          await expect(row.locator("em")).toHaveText("Active");
          await page.unroute(singlePattern);
        }
        const sessions = (await (await current.request.get("/api/v1/auth/sessions")).json()).data.sessions as { id: string; isCurrent: boolean }[];
        const currentId = sessions.find(item => item.isCurrent)!.id;
        expect((await current.request.delete(`/api/v1/auth/sessions/${currentId}`, { headers: { Origin: baseURL! } })).status()).toBe(409);
        const foreignId = (await (await request.get("/api/v1/auth/sessions")).json()).data.sessions.find((item: { isCurrent: boolean }) => item.isCurrent).id;
        expect((await current.request.delete(`/api/v1/auth/sessions/${foreignId}`, { headers: { Origin: baseURL! } })).status()).toBe(404);
        expect((await current.request.post("/api/v1/auth/sessions/revoke-others", { headers: { Origin: "https://untrusted.example.test" } })).status()).toBe(403);
        await row.getByRole("button", { name: "Sign out", exact: true }).click();
        await expect(page.locator(".session-security-page").getByRole("status")).toHaveText("The selected session was signed out.");
        expect((await target.request.get("/api/v1/auth/sessions")).status()).toBe(401);
        expect((await remaining.request.get("/api/v1/auth/sessions")).status()).toBe(200);
        page.once("dialog", dialog => dialog.dismiss());
        await all.click();
        expect((await remaining.request.get("/api/v1/auth/sessions")).status()).toBe(200);
        for (const mode of ["abort", "json", "unconfirmed"]) {
          await page.route("**/api/v1/auth/sessions/revoke-others", route => mode === "abort" ? route.abort("failed") : route.fulfill(mode === "json" ? { contentType: "application/json", body: "invalid JSON" } : { json: { data: {} } }));
          page.once("dialog", dialog => dialog.accept());
          await all.click();
          await expect(page.locator(".session-security-page").getByRole("alert")).toContainText("Could not confirm sign-out");
          await expect(all).toBeEnabled();
          await page.unroute("**/api/v1/auth/sessions/revoke-others");
        }
        page.once("dialog", dialog => { expect(dialog.message()).toContain("including devices not shown"); return dialog.accept(); });
        await all.click();
        await expect(page.locator(".session-security-page").getByRole("status")).toHaveText("1 other active session signed out.");
        expect((await remaining.request.get("/api/v1/auth/sessions")).status()).toBe(401);
        expect((await current.request.get("/api/v1/auth/sessions")).status()).toBe(200);
        await page.reload();
        await expect(page.locator(".session-list .current em")).toHaveText("This device");
        await expect(page.locator(".session-list button")).toHaveCount(0);
        await expect(all).toBeEnabled();
        await fits(page);
      } finally {
        for (const context of contexts) { expect((await context.request.post("/api/v1/auth/logout", { headers: { Origin: baseURL! } })).status()).toBe(200); await context.close(); }
      }
    });
  }

  for (const [name, viewport] of [["desktop", { width: 1440, height: 1000 }], ["mobile", { width: 375, height: 812 }]] as const) {
    test(`customer account review ${name}: phone and identity request recovery`, async ({ browser, baseURL }) => {
      test.skip(!process.env.E2E_ACCOUNT_REVIEW, "Requires isolated account fixtures.");
      test.setTimeout(90_000);
      const context = await browser.newContext({ baseURL, extraHTTPHeaders: accountClientHeaders, viewport, storageState: { cookies: [], origins: [] } });
      try {
        expect((await context.request.post("/api/v1/auth/login", { headers: { Origin: baseURL! }, data: { email: fixture().emptyEmail, password: process.env.E2E_CUSTOMER_PASSWORD, portal: "customer" } })).status()).toBe(200);
        const page = await context.newPage();
        page.setDefaultTimeout(10_000);
        const errors: string[] = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.goto("/profile");
        const panel = page.locator(".identity-verification-panel");
        const fallbackContext = await browser.newContext({ baseURL, extraHTTPHeaders: accountClientHeaders, viewport, javaScriptEnabled: false, storageState: await context.storageState() });
        try {
          const fallback = await fallbackContext.newPage(); await fallback.goto("/profile");
          for (const button of await fallback.locator(".identity-verification-panel button").all()) await expect(button).toBeDisabled();
          for (const form of await fallback.locator(".identity-verification-panel form").all()) await expect(form).toHaveAttribute("method", "post");
        } finally { await fallbackContext.close(); }
        for (const config of [
          { button: "Generate development code", path: "/api/v1/account/phone-verification/request", data: { requested: true, deliveryStatus: "DEVELOPMENT_ONLY", developmentCode: "000000", expiresAt: "2030-01-01T00:00:00.000Z" }, message: "Development test only: no SMS was sent." },
          { button: "Verify phone", path: "/api/v1/account/phone-verification/confirm", data: { verified: true }, message: "Phone number verified successfully." },
          { button: "Upload and submit", path: "/api/v1/account/identity-verifications", data: { submission: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", status: "PENDING" } }, message: "Identity verification submitted for Compliance review." },
        ]) {
          if (config.button === "Verify phone") await panel.getByLabel("Enter the 6-digit code").fill("000000");
          if (config.button === "Upload and submit") {
            await panel.getByLabel("Last 4 characters only").fill("AB12");
            await panel.getByLabel("Clear document photo").setInputFiles({ name: "synthetic-ui-only.png", mimeType: "image/png", buffer: Buffer.from("Synthetic UI-only file, not an identity document") });
          }
          let mode = "abort";
          let calls = 0;
          let release: (() => void) | undefined;
          const held = new Promise<void>(resolve => { release = resolve; });
          await page.route(`**${config.path}`, async route => {
            calls++;
            if (mode === "abort") return route.abort("failed");
            if (mode === "json") return route.fulfill({ contentType: "application/json", body: "invalid JSON" });
            if (mode === "unconfirmed") return route.fulfill({ json: { data: {} } });
            if (mode === "pending") await held;
            if (mode === "success") return route.fulfill({ status: config.button === "Upload and submit" ? 201 : 200, json: { data: config.data } });
            return route.fulfill({ status: 503, json: { error: { message: "Synthetic verification service unavailable" } } });
          });
          for (mode of ["abort", "json", "unconfirmed", "unavailable"]) {
            await panel.getByRole("button", { name: config.button, exact: true }).click();
            await expect(panel.getByRole("alert")).toContainText(mode === "unavailable" ? "Synthetic verification service unavailable" : "Could not confirm this request");
            await expect(panel.getByRole("button", { name: config.button, exact: true })).toBeEnabled();
          }
          if (config.button === "Upload and submit") {
            await expect(panel.getByLabel("Last 4 characters only")).toHaveValue("AB12");
            expect(await panel.getByLabel("Clear document photo").evaluate((input: HTMLInputElement) => input.files?.length)).toBe(1);
            mode = "pending";
            await panel.getByRole("button", { name: config.button, exact: true }).click();
            await expect(panel.getByRole("button", { name: "Uploading securely…" })).toBeDisabled();
            await panel.locator("form").last().dispatchEvent("submit");
            release!();
            await expect(panel.getByRole("alert")).toHaveText("Synthetic verification service unavailable");
            expect(calls).toBe(5);
          }
          mode = "success";
          await panel.getByRole("button", { name: config.button, exact: true }).click();
          await expect(panel.getByRole("status")).toContainText(config.message);
          if (config.button === "Generate development code") await expect(panel.getByText("Development-only code: 000000")).toBeVisible();
          if (config.button === "Upload and submit") {
            await expect(panel.getByLabel("Last 4 characters only")).toHaveValue("");
            expect(await panel.getByLabel("Clear document photo").evaluate((input: HTMLInputElement) => input.files?.length)).toBe(0);
          }
          await page.unroute(`**${config.path}`);
        }
        await fits(page);
        expect(errors).toEqual([]);
        const persisted = (await (await context.request.get("/api/v1/account/identity-verifications")).json()).data;
        expect(persisted.submissions).toHaveLength(0);
        expect(persisted.verification.phoneVerifiedAt).toBeNull();
        await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); window.scrollTo(0, 0); });
        await test.info().attach(`verification-profile-${name}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
      } finally {
        expect((await context.request.post("/api/v1/auth/logout", { headers: { Origin: baseURL! } })).status()).toBe(200);
        await context.close();
      }
    });
  }

  for (const [name, viewport] of [["desktop", { width: 1440, height: 1000 }], ["mobile", { width: 375, height: 812 }]] as const) {
    test(`customer account review ${name}: profile and address CRUD recovery`, async ({ browser, baseURL, request }) => {
      test.skip(!process.env.E2E_PROFILE_CUSTOMERS, "Requires isolated profile fixtures.");
      test.setTimeout(90_000);
      const customer = (JSON.parse(process.env.E2E_PROFILE_CUSTOMERS!) as Record<string, { email: string }>)[name];
      const context = await browser.newContext({ baseURL, extraHTTPHeaders: accountClientHeaders, viewport, storageState: { cookies: [], origins: [] } });
      try {
        expect((await context.request.post("/api/v1/auth/login", { headers: { Origin: baseURL! }, data: { email: customer.email, password: process.env.E2E_CUSTOMER_PASSWORD, portal: "customer" } })).status()).toBe(200);
        const page = await context.newPage(); await page.goto("/profile");
        const manager = page.locator(".profile-manager");
        const profile = manager.locator(".profile-form");
        const book = manager.locator(".address-book");
        const add = book.locator(".new-address form");
        await profile.getByLabel("Full name", { exact: true }).fill(`Synthetic updated ${name}`);
        const noScript = await browser.newContext({ baseURL, extraHTTPHeaders: accountClientHeaders, viewport, javaScriptEnabled: false, storageState: await context.storageState() });
        try {
          const fallback = await noScript.newPage(); await fallback.goto("/profile");
          for (const button of await fallback.locator(".profile-manager button").all()) await expect(button).toBeDisabled();
          for (const form of await fallback.locator(".profile-manager form").all()) await expect(form).toHaveAttribute("method", "post");
        } finally { await noScript.close(); }
        async function recover(scope: ReturnType<Page["locator"]>, pattern: string, submit: () => Promise<unknown>) {
          for (const mode of ["abort", "json", "unconfirmed", "rejected"]) {
            await page.route(pattern, route => mode === "abort" ? route.abort("failed") : route.fulfill(mode === "json" ? { contentType: "application/json", body: "invalid JSON" } : mode === "unconfirmed" ? { json: { data: {} } } : { status: 422, json: { error: { message: "Synthetic input validation error" } } }));
            await submit();
            await expect(scope.getByRole("alert")).toContainText(mode === "rejected" ? "Synthetic input validation error" : "Could not confirm this change");
            await expect(manager.getByRole("button", { name: "Save profile", exact: true })).toBeEnabled();
            await page.unroute(pattern);
          }
        }
        await recover(profile, "**/api/v1/users/me", () => profile.getByRole("button", { name: "Save profile", exact: true }).click());
        await expect(profile.getByLabel("Full name", { exact: true })).toHaveValue(`Synthetic updated ${name}`);
        await profile.getByRole("button", { name: "Save profile", exact: true }).click();
        await expect(profile.getByRole("status")).toHaveText("Profile saved securely.");
        // Retry only a transport-level reset on this read-only confirmation.
        // Never replay the profile mutation; database audit checks still require
        // exactly one saved change in the isolated runner.
        expect((await (await context.request.get("/api/v1/users/me", { maxRetries: 1 })).json()).data.user.fullName).toBe(`Synthetic updated ${name}`);
        async function fillAddress(label: string) {
          await add.getByLabel("Address label", { exact: true }).fill(label);
          await add.getByLabel("Recipient name").fill("Synthetic recipient");
          await add.getByLabel("Phone number").fill("+8801700000099");
          await add.getByLabel("Address line 1", { exact: true }).fill("Synthetic test road 123");
          await add.getByLabel("City", { exact: true }).fill("Dhaka");
          await add.getByLabel("State, province, or district").fill("Dhaka");
        }
        await fillAddress("Synthetic Home");
        await recover(book, "**/api/v1/users/me/addresses", () => add.getByRole("button", { name: "Add address", exact: true }).click());
        await expect(add.getByLabel("Address line 1", { exact: true })).toHaveValue("Synthetic test road 123");
        await add.getByRole("button", { name: "Add address", exact: true }).click();
        await expect(book.getByRole("status")).toHaveText("Address added.");
        const cards = book.locator(".profile-address-list>article");
        await expect(cards).toHaveCount(1);
        await book.locator(".new-address summary").click();
        await fillAddress("Synthetic Office");
        await add.getByRole("button", { name: "Add address", exact: true }).click();
        await expect(cards).toHaveCount(2);
        const office = cards.filter({ has: page.locator(".profile-address-title b", { hasText: "Synthetic Office" }) });
        await office.getByText("Edit", { exact: true }).click();
        const edit = office.locator("form");
        await edit.getByLabel("City", { exact: true }).fill("Chattogram");
        await recover(book, "**/api/v1/users/me/addresses/*", () => edit.getByRole("button", { name: "Save address", exact: true }).click());
        await edit.getByRole("button", { name: "Save address", exact: true }).click();
        await expect(book.getByRole("status")).toHaveText("Address updated.");
        await recover(book, "**/api/v1/users/me/addresses/*", () => office.getByRole("button", { name: "Make default", exact: true }).click());
        await office.getByRole("button", { name: "Make default", exact: true }).click();
        await expect(book.getByRole("status")).toHaveText("Default address changed.");
        let saved = (await (await context.request.get("/api/v1/users/me/addresses")).json()).data.addresses as { id: string; label: string; city: string; isDefault: boolean }[];
        expect(saved.filter(address => address.isDefault)).toHaveLength(1);
        const officeId = saved.find(address => address.label === "Synthetic Office")!.id;
        expect(saved.find(address => address.id === officeId)?.city).toBe("Chattogram");
        expect((await request.patch(`/api/v1/users/me/addresses/${officeId}`, { headers: { Origin: baseURL! }, data: { city: "Must not change" } })).status()).toBe(404);
        expect((await request.delete(`/api/v1/users/me/addresses/${officeId}`, { headers: { Origin: baseURL! } })).status()).toBe(404);
        expect((await context.request.patch(`/api/v1/users/me/addresses/${officeId}`, { headers: { Origin: "https://untrusted.example.test" }, data: { city: "Must not change" } })).status()).toBe(403);
        page.once("dialog", dialog => dialog.dismiss()); await office.getByRole("button", { name: "Remove", exact: true }).click();
        await expect(cards).toHaveCount(2);
        await recover(book, "**/api/v1/users/me/addresses/*", async () => { page.once("dialog", dialog => dialog.accept()); await office.getByRole("button", { name: "Remove", exact: true }).click(); });
        page.once("dialog", dialog => dialog.accept()); await office.getByRole("button", { name: "Remove", exact: true }).click();
        await expect(cards).toHaveCount(1);
        saved = (await (await context.request.get("/api/v1/users/me/addresses")).json()).data.addresses;
        expect(saved[0].isDefault).toBe(true);
        page.once("dialog", dialog => dialog.accept()); await cards.getByRole("button", { name: "Remove", exact: true }).click();
        await expect(cards).toHaveCount(0);
        await page.reload(); await expect(book.getByText("No saved address yet")).toBeVisible();
        await fits(page);
      } finally {
        expect((await context.request.post("/api/v1/auth/logout", { headers: { Origin: baseURL! } })).status()).toBe(200);
        await context.close();
      }
    });
  }

  test("anonymous and warehouse sessions cannot open customer account pages", async ({ browser, baseURL }) => {
    test.skip(!process.env.E2E_ACCOUNT_REVIEW, "Requires isolated account fixtures.");
    test.setTimeout(60_000);
    for (const state of [undefined, "e2e/.auth/warehouse.json"]) {
      const context = await browser.newContext({ baseURL, extraHTTPHeaders: accountClientHeaders, storageState: state });
      try {
        const page = await context.newPage();
        for (const path of ["/dashboard", "/orders", `/orders/${fixture().orderId}`]) {
          await page.goto(path);
          await expect(page).toHaveURL(/\/login\?next=/);
          await expect(page.locator(".customer-dashboard-content, .orders-page, .order-product-list")).toHaveCount(0);
        }
      } finally { await context.close(); }
    }
  });
});
