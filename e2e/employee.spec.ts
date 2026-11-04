import { test, expect } from "./fixtures";
import { createHmac } from "node:crypto";
import type { Page } from "@playwright/test";

async function pausePurchaseRefresh(page: Page, orderId: string) {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const pattern = `**/admin/purchases/${orderId}*`;
  const active = new Set<Promise<void>>();
  const handler = async (route: import("@playwright/test").Route) => {
    const operation = (async () => {
      if (route.request().headers().rsc === "1") await gate;
      await route.continue();
    })();
    active.add(operation);
    try { await operation; } finally { active.delete(operation); }
  };
  await page.route(pattern, handler);
  return async () => { release(); await Promise.all([...active]); await page.unroute(pattern, handler); };
}

function authenticatorCode(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret].map(character => alphabet.indexOf(character).toString(2).padStart(5, "0")).join("");
  const bytes = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

test.describe("admin MFA", () => {
  test.describe.configure({ retries: 0 });
  test("MFA gates quote issuance and single-use recovery", async ({ browser, baseURL }) => {
    test.skip(!process.env.E2E_ADMIN, "Requires a disposable administrator.");
    test.setTimeout(240_000);
    const credentials = JSON.parse(process.env.E2E_ADMIN!) as { capacity: { orderId: string; recordId: string; holdHistoryId: string }; pagedOrderId: string; email: string; password: string; inbound: { orderId: string; orderNumber: string; warehouseId: string; parcels: { recordId: string; reference: string; tracking: string }[] }; reviewer: { email: string; password: string }; correction: { orderId: string; recordId: string }; manualPurchase: { orderId: string; orderNumber: string; warehouseId: string }; issuance: { orderId: string; orderNumber: string; laneId: string } };
    const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
    const returning = await browser.newContext({ baseURL });
    try {
      const page = await context.newPage();
      const hydrationWarnings: string[] = [];
      page.on("console", message => {
        if (/hydration|hydrated|server rendered HTML didn't match/i.test(message.text())) hydrationWarnings.push(message.text().split("\n")[0]);
      });
      await page.goto("/admin/login");
      await page.getByLabel("Email", { exact: true }).fill(credentials.email);
      await page.getByLabel("Password", { exact: true }).fill(credentials.password);
      const setupResponse = page.waitForResponse(response => response.url().endsWith("/auth/mfa/setup") && response.request().method() === "POST");
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      const setup = await setupResponse;
      expect(setup.status()).toBe(200);
      const secret = (await setup.json()).data.secret as string;
      expect((await context.request.get("/api/v1/admin/users")).status()).toBe(403);
      await page.getByLabel("6-digit code", { exact: true }).fill(authenticatorCode(secret));
      const confirmed = page.waitForResponse(response => response.url().endsWith("/auth/mfa/confirm") && response.request().method() === "POST");
      await page.getByRole("button", { name: "Enable and continue" }).click();
      const confirmation = await confirmed;
      expect(confirmation.status()).toBe(200);
      const codes = (await confirmation.json()).data.recoveryCodes as string[];
      expect(codes.length).toBe(10);
      await expect(page.getByRole("heading", { name: "Recovery codes", exact: true })).toBeVisible();
      expect((await context.request.get("/api/v1/admin/users")).status()).toBe(200);
      await page.goto(`/admin/purchases/${credentials.capacity.orderId}`);
      await expect(page.getByRole("heading", { name: "Evidence record limit reached", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Save private supplier record" })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      const pagedEndpoint = `/api/v1/admin/orders/${credentials.pagedOrderId}/supplier-records`;
      const firstRecords = await context.request.get(pagedEndpoint);
      expect(firstRecords.status()).toBe(200);
      expect(firstRecords.headers()["cache-control"]).toContain("no-store");
      const firstData = (await firstRecords.json()).data;
      expect(firstData.records).toHaveLength(100);
      expect(firstData.pagination).toEqual({ page: 1, pageSize: 100, total: 101, pages: 2 });
      const secondData = (await (await context.request.get(`${pagedEndpoint}?page=2`)).json()).data;
      expect(secondData.records.map((record: { supplierOrderReference: string }) => record.supplierOrderReference)).toEqual(["PRIVATE-PAGED-100"]);
      expect(secondData.records[0].requestFingerprint).toBeUndefined();
      expect((await (await context.request.get(`${pagedEndpoint}?page=3`)).json()).data.records).toEqual([]);
      for (const query of ["page=0", "page=1&page=2", "page=10001", "page=1e3"]) expect((await context.request.get(`${pagedEndpoint}?${query}`)).status()).toBe(422);
      const paginationViewer = await context.newPage();
      await paginationViewer.goto(`/admin/purchases/${credentials.pagedOrderId}`);
      const pageLinks = paginationViewer.getByRole("navigation", { name: "Supplier record pages" }).filter({ visible: true });
      await expect(pageLinks).toContainText("Page 1 of 6");
      await expect(paginationViewer.getByLabel("Supplier order reference", { exact: true })).toHaveCount(0);
      await pageLinks.getByRole("link", { name: "Next records" }).click();
      await expect(pageLinks).toContainText("Page 2 of 6");
      await expect(paginationViewer.getByText("PRIVATE-PAGED-020", { exact: true }).filter({ visible: true })).toBeVisible();
      await paginationViewer.goto(`/admin/purchases/${credentials.pagedOrderId}?page=6`);
      await expect(pageLinks).toContainText("Page 6 of 6");
      await expect(paginationViewer.getByText("PRIVATE-PAGED-100", { exact: true }).filter({ visible: true })).toBeVisible();
      await expect(pageLinks.getByRole("link", { name: "Next records" })).toHaveCount(0);
      expect(await paginationViewer.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await test.info().attach("Supplier records mobile pagination", { body: await pageLinks.screenshot(), contentType: "image/png" });
      expect((await paginationViewer.goto(`/admin/purchases/${credentials.pagedOrderId}?page=7`))?.status()).toBe(404);
      await paginationViewer.close();
      const privateListCheck = await browser.newContext({ baseURL, storageState: "e2e/.auth/customer.json" });
      try { expect((await privateListCheck.request.get(`${pagedEndpoint}?page=2`)).status()).toBe(403); }
      finally { await privateListCheck.close(); }
      await page.goto("/admin/purchases");
      const purchase = page.locator("#admin-main-content .purchase-review-card").filter({ hasText: credentials.manualPurchase.orderNumber });
      await expect(purchase.getByText("Step 1 · Verify before approval")).toBeVisible();
      await purchase.getByLabel("Internal Admin note").fill("PRIVATE-SUPPLIER-FIXTURE stock and price verified");
      const purchaseEndpoint = `/api/v1/admin/orders/${credentials.manualPurchase.orderId}/purchase-review`;
      await page.route(`**${purchaseEndpoint}`, route => route.abort("failed"));
      await purchase.getByRole("button", { name: "Approve for purchase", exact: true }).click();
      await expect(purchase.getByRole("alert")).toContainText("Refresh the order");
      await expect(purchase.getByRole("button", { name: "Approve for purchase", exact: true })).toBeEnabled();
      await page.unroute(`**${purchaseEndpoint}`);
      const decision = { action: "APPROVE_FOR_PURCHASE", note: "PRIVATE-SUPPLIER-FIXTURE approval evidence" };
      const concurrent = await Promise.all([1, 2].map(() => context.request.patch(purchaseEndpoint, { headers: { Origin: baseURL! }, data: decision })));
      expect(concurrent.map(response => response.status()).sort()).toEqual([200, 409]);
      await page.reload();
      await expect(purchase.getByText("Step 2 · Record the actual purchase")).toBeVisible();
      expect((await context.request.patch(purchaseEndpoint, { headers: { Origin: baseURL! }, data: { action: "MARK_PURCHASED", note: "Attempt without supplier records" } })).status()).toBe(409);
      await purchase.getByRole("link", { name: "Supplier references & items" }).click();
      await expect(page.getByRole("heading", { name: "Supplier order records", exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      await page.getByLabel("Supplier name", { exact: true }).fill("PRIVATE-SUPPLIER-FIXTURE");
      await page.getByLabel("Supplier order reference", { exact: true }).fill("PRIVATE-REFERENCE-FIXTURE");
      await page.getByLabel("Exact variant or SKU").fill("Blue / standard");
      await page.getByLabel("Quantity in this supplier order").fill("2");
      await page.getByLabel("Receiving origin warehouse").selectOption(credentials.manualPurchase.warehouseId);
      const supplierEndpoint = `/api/v1/admin/orders/${credentials.manualPurchase.orderId}/supplier-records`;
      await page.route(`**${supplierEndpoint}`, route => route.abort("failed"));
      await page.getByRole("button", { name: "Save private supplier record" }).click();
      await expect(page.locator("form.integration-create-form").getByRole("alert")).toContainText("may already have been saved");
      await expect(page.getByRole("button", { name: "Save private supplier record" })).toBeEnabled();
      await page.unroute(`**${supplierEndpoint}`);
      const supplierSaved = page.waitForResponse(response => response.url().endsWith(supplierEndpoint) && response.request().method() === "POST");
      await page.getByRole("button", { name: "Save private supplier record" }).click();
      const supplierResponse = await supplierSaved;
      expect(supplierResponse.status()).toBe(201);
      const record = (await supplierResponse.json()).data.record;
      expect(record.quantity).toBe(2);
      expect(record.idempotencyKey).toBeUndefined(); expect(record.requestFingerprint).toBeUndefined();
      const supplierPayload = supplierResponse.request().postDataJSON();
      const requestKey = supplierResponse.request().headers()["idempotency-key"];
      const supplierHeaders = { Origin: baseURL!, "Idempotency-Key": requestKey };
      expect((await context.request.post(supplierEndpoint, { headers: supplierHeaders, data: supplierPayload })).status()).toBe(200);
      expect((await context.request.post(supplierEndpoint, { headers: supplierHeaders, data: { ...supplierPayload, quantity: 1 } })).status()).toBe(409);
      expect((await context.request.post(supplierEndpoint, { headers: { ...supplierHeaders, "Idempotency-Key": "fixture-over-allocation-key" }, data: { ...supplierPayload, supplierOrderReference: "OTHER-REFERENCE", quantity: 1 } })).status()).toBe(409);
      expect((await context.request.post(supplierEndpoint, { headers: { ...supplierHeaders, "Idempotency-Key": "x".repeat(255) }, data: { ...supplierPayload, quantity: 1 } })).status()).toBe(409);
      await expect(page.getByText("PRIVATE-REFERENCE-FIXTURE", { exact: true })).toBeVisible();
      await page.goto("/admin/purchases");
      await purchase.getByLabel("Internal Admin note").fill("PRIVATE-SUPPLIER-FIXTURE confirmed external purchase");
      const confirmedPurchase = page.waitForResponse(response => response.url().endsWith(purchaseEndpoint) && response.request().method() === "PATCH");
      await purchase.getByRole("button", { name: "Mark purchased", exact: true }).click();
      expect((await confirmedPurchase).status()).toBe(200);
      await expect(purchase.getByText("PURCHASED — RECORD DISPATCH", { exact: true })).toBeVisible();
      const customerCheck = await browser.newContext({ baseURL, storageState: "e2e/.auth/customer.json" });
      try {
        const timeline = await customerCheck.request.get(`/api/v1/orders/${credentials.manualPurchase.orderId}/timeline`);
        expect(timeline.status()).toBe(200);
        const history = (await timeline.json()).data.order.statusHistory;
        expect(history.map((event: { toStatus: string }) => event.toStatus)).toEqual(["SOURCING", "PURCHASED"]);
        expect(JSON.stringify(history)).not.toContain("PRIVATE-SUPPLIER-FIXTURE");
        expect(JSON.stringify(history)).not.toContain("PRIVATE-REFERENCE-FIXTURE");
        expect((await customerCheck.request.get(supplierEndpoint)).status()).toBe(403);
        expect((await customerCheck.request.patch(purchaseEndpoint, { headers: { Origin: baseURL! }, data: decision })).status()).toBe(403);
      } finally { await customerCheck.close(); }
      const receiptWorker = await browser.newContext({ baseURL, storageState: "e2e/.auth/warehouse.json" });
      try {
        await page.goto(`/admin/purchases/${credentials.inbound.orderId}`);
        const nextTask = page.getByRole("region", { name: "What to do next" }).filter({ visible: true });
        await expect(nextTask).toContainText("2 remaining supplier record(s)");
        await expect(nextTask.locator('[aria-current="step"]')).toHaveText(/Record dispatch details/);
        expect((await context.request.patch(`/api/v1/admin/orders/${credentials.inbound.orderId}/status`, { headers: { Origin: baseURL! }, data: { status: "SUPPLIER_SHIPPED", note: "Attempt manual dispatch bypass" } })).status()).toBe(409);
        for (const [index, parcel] of credentials.inbound.parcels.entries()) {
          const parcelCard = page.locator(".platform-admin-card").filter({ hasText: parcel.reference });
          await parcelCard.getByLabel("Domestic carrier", { exact: true }).fill("Synthetic domestic carrier");
          await parcelCard.getByLabel("Domestic tracking reference").fill(parcel.tracking);
          await parcelCard.getByRole("checkbox", { name: "I checked the supplier dispatch confirmation." }).check();
          const dispatchEndpoint = `/api/v1/admin/orders/${credentials.inbound.orderId}/supplier-records/${parcel.recordId}/dispatch`;
          if (index === 0) {
            await page.route(`**${dispatchEndpoint}`, route => route.abort("failed"));
            await parcelCard.getByRole("button", { name: "Save expected arrival" }).click();
            await expect(parcelCard.getByRole("alert")).toContainText("may already have been saved");
            await page.unroute(`**${dispatchEndpoint}`);
          }
          const dispatchedWait = page.waitForResponse(response => response.url().endsWith(dispatchEndpoint) && response.request().method() === "POST");
          let dispatched: import("@playwright/test").Response;
          const resumeDispatchRefresh = await pausePurchaseRefresh(page, credentials.inbound.orderId);
          try {
            await parcelCard.getByRole("button", { name: "Save expected arrival" }).click();
            dispatched = await dispatchedWait;
            // Diagnose routing/server rejection before waiting for a success-only
            // UI state. Never retry a potentially committed dispatch mutation.
            expect(dispatched.status(), `Dispatch response: content-type=${dispatched.headers()["content-type"] ?? "missing"}; request-id=${dispatched.headers()["x-request-id"] ?? "missing"}`).toBe(201);
            await expect(parcelCard.getByRole("button", { name: "Expected arrival saved", exact: true })).toBeDisabled();
            await expect(parcelCard.getByLabel("Domestic tracking reference")).toBeDisabled();
            await expect(parcelCard.getByRole("status")).toContainText("do not submit again");
          } finally { await resumeDispatchRefresh(); }
          const dispatch = (await dispatched.json()).data.dispatch;
          expect(dispatch.package.status).toBe("EXPECTED");
          expect(dispatch.requestFingerprint).toBeUndefined();
          const dispatchPayload = dispatched.request().postDataJSON();
          const dispatchHeaders = { Origin: baseURL!, "Idempotency-Key": dispatched.request().headers()["idempotency-key"] };
          expect((await receiptWorker.request.post(dispatchEndpoint, { headers: dispatchHeaders, data: dispatchPayload })).status()).toBe(403);
          expect((await context.request.post(dispatchEndpoint, { headers: dispatchHeaders, data: dispatchPayload })).status()).toBe(200);
          expect((await context.request.post(dispatchEndpoint, { headers: dispatchHeaders, data: { ...dispatchPayload, trackingNumber: "OTHER-TRACKING" } })).status()).toBe(409);
          await expect(parcelCard.getByText(/Awaiting physical receipt/)).toBeVisible();
          await expect(nextTask).toContainText(index === 0 ? "1 remaining supplier record(s)" : "physical warehouse confirmation of 2 parcel(s)");
          if (index === 0) expect((await receiptWorker.request.post("/api/v1/operations/packages/receive", { headers: { Origin: baseURL!, "Idempotency-Key": "fixture-partial-dispatch-receipt" }, data: { orderNumber: credentials.inbound.orderNumber, warehouseId: credentials.inbound.warehouseId, packageCode: dispatch.package.packageCode } })).status()).toBe(409);
        }
        expect((await context.request.patch(`/api/v1/admin/orders/${credentials.inbound.orderId}/status`, { headers: { Origin: baseURL! }, data: { status: "WAREHOUSE_RECEIVED", note: "Attempt physical receipt bypass" } })).status()).toBe(409);
        const privacyPage = await receiptWorker.newPage();
        await privacyPage.goto("/warehouse");
        await expect(privacyPage.getByText("PRIVATE-INBOUND-SUPPLIER", { exact: true })).toHaveCount(0);
        await expect(privacyPage.getByText("PRIVATE-DISPATCH-0", { exact: true })).toHaveCount(0);
        // Refresh can replace the execution context. Retry only this read-only
        // layout assertion, never dispatch/receipt mutations.
        await expect(async () => {
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
        }).toPass({ timeout: 10_000 });
        const inboundCustomer = await browser.newContext({ baseURL, storageState: "e2e/.auth/customer.json" });
        const inboundInspector = await browser.newContext({ baseURL, storageState: "e2e/.auth/inspector.json" });
        try {
      for (const [index, parcel] of credentials.inbound.parcels.entries()) {
        await privacyPage.goto("/warehouse/scan");
        await privacyPage.getByLabel("Package, order, or inbound tracking code").fill(parcel.tracking);
        await privacyPage.getByRole("button", { name: "Open task", exact: true }).click();
        await expect(privacyPage.getByRole("heading", { name: /PKG-/ })).toBeVisible();
        if (index === 0) {
          const noScriptReceipt = await browser.newContext({ baseURL, javaScriptEnabled: false, storageState: await receiptWorker.storageState() });
          try {
            const fallback = await noScriptReceipt.newPage();
            await fallback.goto(privacyPage.url());
            await expect(fallback.getByRole("button", { name: "Confirm package received" })).toBeDisabled();
            await expect(fallback.locator("form.warehouse-task-form")).toHaveAttribute("method", "post");
            await expect(fallback.getByText("Enable JavaScript to confirm receipt. Nothing has been received by this form.")).toBeVisible();
          } finally { await noScriptReceipt.close(); }
        }
        const receipt = await test.step(`Receive supplier parcel ${index + 1}`, async () => {
          await expect(privacyPage.getByRole("heading", { name: /PKG-/ })).toBeVisible();
          const [response] = await Promise.all([
            privacyPage.waitForResponse(response => response.url().endsWith("/operations/packages/receive") && response.request().method() === "POST", { timeout: 20_000 }),
            privacyPage.getByRole("button", { name: "Confirm package received" }).click(),
          ]);
          return response;
        });
        expect(receipt.status()).toBe(201);
        const supplierPackage = (await receipt.json()).data.package;
        await expect(privacyPage.locator(".warehouse-package-title").getByText("RECEIVED", { exact: true })).toBeVisible();
        const timeline = await inboundCustomer.request.get(`/api/v1/orders/${credentials.inbound.orderId}/timeline`);
        const supplierOrder = (await timeline.json()).data.order;
        expect(supplierOrder.status).toBe(index === 0 ? "SUPPLIER_SHIPPED" : "WAREHOUSE_RECEIVED");
        expect(JSON.stringify(supplierOrder.statusHistory)).not.toContain("PRIVATE");
        if (index === 0) {
          expect((await inboundInspector.request.post(`/api/v1/operations/packages/${supplierPackage.id}/inspect`, { headers: { Origin: baseURL!, "Idempotency-Key": `blocked-inspection-${supplierPackage.id}` }, data: { type: "BASIC", result: "PASSED" } })).status()).toBe(409);
          const waitingInspector = await inboundInspector.newPage();
          await waitingInspector.goto(`/inspector/packages/${supplierPackage.packageCode}`);
          await expect(waitingInspector.getByRole("button", { name: "Complete inspection" })).toHaveCount(0);
          await expect(waitingInspector.getByText(/Waiting for every expected parcel/)).toBeVisible();
          await waitingInspector.close();
        }
      }
        } finally { await inboundCustomer.close(); await inboundInspector.close(); }
        await page.reload();
        await expect(nextTask).toContainText("Receiving is recorded");
        await expect(nextTask.locator('[aria-current="step"]')).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Save expected arrival" })).toHaveCount(0);
      } finally { await receiptWorker.close(); }
      const correctionEndpoint = `/api/v1/admin/orders/${credentials.correction.orderId}/purchase-review`;
      const correctionDecision = { action: "PLACE_ON_HOLD", note: "PRIVATE correction: mistaken variant", supplierRecordId: credentials.correction.recordId };
      expect((await context.request.patch(correctionEndpoint, { headers: { Origin: baseURL! }, data: { ...correctionDecision, supplierRecordId: record.id } })).status()).toBe(409);
      expect((await context.request.patch(purchaseEndpoint, { headers: { Origin: baseURL! }, data: correctionDecision })).status()).toBe(409);
      expect((await context.request.patch(correctionEndpoint, { headers: { Origin: "https://untrusted.example.test" }, data: correctionDecision })).status()).toBe(403);
      await test.step("Navigate to correction record", async () => {
        await page.goto(`/admin/purchases/${credentials.correction.orderId}`, { waitUntil: "domcontentloaded", timeout: 20_000 });
      });
      // Next may retain an inactive route tree. Operate only on the visible
      // record, rather than matching a hidden form from the previous order.
      const correctionCard = page.locator(".platform-admin-card").filter({ hasText: "PRIVATE-CORRECTION-REF" }).filter({ visible: true });
      const noScript = await browser.newContext({ baseURL, javaScriptEnabled: false, storageState: await context.storageState() });
      try {
        const fallback = await noScript.newPage();
        await fallback.goto(`/admin/purchases/${credentials.correction.orderId}`);
        const fallbackCard = fallback.locator(".platform-admin-card").filter({ hasText: "PRIVATE-CORRECTION-REF", visible: true });
        await expect(fallbackCard).toHaveCount(1);
        await expect(fallbackCard.locator("details")).toHaveAttribute("inert", "");
        await expect(fallbackCard.getByText("Preparing secure correction form. Enable JavaScript if it stays unavailable. No hold has been placed.")).toBeVisible();
        await fallbackCard.locator("summary").click({ force: true });
        await expect(fallbackCard.locator("details")).not.toHaveAttribute("open");
        await expect(fallbackCard.locator("form")).toHaveAttribute("method", "post");
        await expect(fallbackCard.locator('button[type="submit"]')).toBeDisabled();
      } finally { await noScript.close(); }
      await test.step("Open correction report", async () => {
        await expect(correctionCard.locator("details")).not.toHaveAttribute("inert");
        await correctionCard.getByText("Report record mistake", { exact: true }).click({ timeout: 15_000 });
      });
      await correctionCard.getByLabel("Private correction reason").fill(correctionDecision.note);
      await correctionCard.getByRole("checkbox", { name: "I understand this places the entire order on hold." }).check();
      await page.route(`**${correctionEndpoint}`, route => route.abort("failed"));
      await correctionCard.getByRole("button", { name: "Report mistake & hold order" }).click();
      await expect(correctionCard.locator("details").getByRole("alert")).toContainText("may already have been saved");
      expect(new URL(page.url()).searchParams.has("reason")).toBe(false);
      await page.unroute(`**${correctionEndpoint}`);
      const held = page.waitForResponse(response => response.url().endsWith(correctionEndpoint) && response.request().method() === "PATCH");
      await correctionCard.getByRole("button", { name: "Report mistake & hold order" }).click();
      expect((await held).status()).toBe(200);
      await expect(page.getByText("Read-only at this stage", { exact: true })).toBeVisible();
      await expect(correctionCard.getByText("Report record mistake", { exact: true })).toHaveCount(0);
      expect((await context.request.patch(correctionEndpoint, { headers: { Origin: baseURL! }, data: correctionDecision })).status()).toBe(409);
      await expect(page.getByText("PRIVATE-CORRECTION-REF", { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      const independent = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
      try {
        const reviewerPage = await independent.newPage();
        await reviewerPage.goto("/admin/login");
        await reviewerPage.getByLabel("Email", { exact: true }).fill(credentials.reviewer.email);
        await reviewerPage.getByLabel("Password", { exact: true }).fill(credentials.reviewer.password);
        const setupWait = reviewerPage.waitForResponse(response => response.url().endsWith("/auth/mfa/setup") && response.request().method() === "POST");
        await reviewerPage.getByRole("button", { name: "Continue", exact: true }).click();
        const reviewerSecret = (await (await setupWait).json()).data.secret;
        await reviewerPage.getByLabel("6-digit code", { exact: true }).fill(authenticatorCode(reviewerSecret));
        const mfaWait = reviewerPage.waitForResponse(response => response.url().endsWith("/auth/mfa/confirm") && response.request().method() === "POST");
        await reviewerPage.getByRole("button", { name: "Enable and continue" }).click();
        expect((await mfaWait).status()).toBe(200);
        await reviewerPage.goto(`/admin/purchases/${credentials.capacity.orderId}`);
        const capacityNotice = reviewerPage.getByRole("region", { name: "Correction capacity review" }).filter({ visible: true });
        await expect(capacityNotice).toContainText("Keep the order on hold");
        await expect(reviewerPage.getByRole("button", { name: "Approve replacement & return to Sourcing" })).toHaveCount(0);
        expect(await reviewerPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        await test.info().attach("Correction capacity mobile notice", { body: await capacityNotice.screenshot(), contentType: "image/png" });
        const capacityResponse = await independent.request.post(`/api/v1/admin/orders/${credentials.capacity.orderId}/supplier-records/${credentials.capacity.recordId}/correction`, { headers: { Origin: baseURL!, "Idempotency-Key": "capacity-fixture-independent-approval" }, data: { supplierName: "PRIVATE-CAPPED-SUPPLIER", supplierOrderReference: "PRIVATE-CAPPED-0", variantDescription: "Changed synthetic capacity variant", reason: "Synthetic independent review", holdHistoryId: credentials.capacity.holdHistoryId } });
        expect(capacityResponse.status()).toBe(409);
        expect((await capacityResponse.json()).error.code).toBe("RECORD_LIMIT");
        await reviewerPage.goto("/admin/purchases");
        const heldLink = reviewerPage.locator(`a[href="/admin/purchases/${credentials.correction.orderId}"]`).filter({ visible: true });
        await expect(heldLink).toHaveCount(1);
        await expect(heldLink).toBeVisible();
        await heldLink.click();
        await reviewerPage.getByLabel("Correct variant description").fill("PRIVATE corrected variant");
        await reviewerPage.getByLabel("Approval reason").fill("PRIVATE independent supplier confirmation checked");
        await reviewerPage.getByRole("checkbox", { name: "I independently verified this correction and approve return to Sourcing." }).check();
        expect(await reviewerPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
        const replacementEndpoint = `/api/v1/admin/orders/${credentials.correction.orderId}/supplier-records/${credentials.correction.recordId}/correction`;
        await reviewerPage.route(`**${replacementEndpoint}`, route => route.abort("failed"));
        await reviewerPage.getByRole("button", { name: "Approve replacement & return to Sourcing" }).click();
        await expect(reviewerPage.getByRole("alert").filter({ hasText: "may already have been saved" })).toBeVisible();
        await reviewerPage.unroute(`**${replacementEndpoint}`);
        await reviewerPage.route(`**${replacementEndpoint}`, async route => {
          const payload = route.request().postDataJSON();
          const headers = { Origin: baseURL!, "Idempotency-Key": "fixture-independent-approval-check" };
          const selfApproval = await context.request.post(replacementEndpoint, { headers, data: payload });
          expect(selfApproval.status()).toBe(409);
          expect((await selfApproval.json()).error.code).toBe("INDEPENDENT_ADMIN_REQUIRED");
          expect((await independent.request.post(replacementEndpoint, { headers, data: { ...payload, quantity: 20 } })).status()).toBe(422);
          expect((await independent.request.post(replacementEndpoint, { headers, data: { ...payload, holdHistoryId: "11111111-1111-4111-8111-111111111111" } })).status()).toBe(409);
          await route.continue();
        });
        const replaceWait = reviewerPage.waitForResponse(response => response.url().endsWith(replacementEndpoint) && response.request().method() === "POST");
        const resumeCorrectionRefresh = await pausePurchaseRefresh(reviewerPage, credentials.correction.orderId);
        try {
          await reviewerPage.getByRole("button", { name: "Approve replacement & return to Sourcing" }).click();
          await expect(reviewerPage.getByRole("button", { name: "Replacement approved", exact: true })).toBeDisabled();
          await expect(reviewerPage.getByLabel("Approval reason")).toBeDisabled();
          await expect(reviewerPage.getByRole("status").filter({ hasText: "Replacement approved" })).toContainText("do not approve again");
        } finally { await resumeCorrectionRefresh(); }
        const replaced = await replaceWait;
        expect(replaced.status()).toBe(201);
        const replacementPayload = replaced.request().postDataJSON();
        const replacementHeaders = { Origin: baseURL!, "Idempotency-Key": replaced.request().headers()["idempotency-key"] };
        expect((await independent.request.post(replacementEndpoint, { headers: replacementHeaders, data: replacementPayload })).status()).toBe(200);
        expect((await independent.request.post(replacementEndpoint, { headers: replacementHeaders, data: { ...replacementPayload, reason: "changed retry reason" } })).status()).toBe(409);
        await expect(reviewerPage.getByText("Superseded · retained for audit, excluded from quantity totals", { exact: true })).toBeVisible();
        await expect(reviewerPage.getByText("PRIVATE corrected variant · 1", { exact: true })).toBeVisible();
      } finally { await independent.close(); }
      await page.goto("/admin/shipping-quotes");
      const card = page.locator("#admin-main-content .operations-order-card").filter({ hasText: credentials.issuance.orderNumber });
      await card.getByLabel("Active shipping service").selectOption(credentials.issuance.laneId);
      await card.getByLabel("International rate per kg (BDT)", { exact: true }).fill("800");
      await card.getByLabel("Handling fee (BDT)").fill("100");
      const futureLocalExpiry = await page.evaluate(() => {
        const future = new Date(Date.now() + 3_600_000);
        return new Date(future.getTime() - future.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
      });
      await card.getByLabel("Quote expiry").fill(futureLocalExpiry);
      await card.getByLabel("Customer note").fill("Synthetic browser-issued shipping quote.");
      const quoteEndpoint = `/api/v1/admin/orders/${credentials.issuance.orderId}/shipping-quote`;
      await page.route(`**${quoteEndpoint}`, route => route.abort("failed"));
      const sendQuote = card.getByRole("button", { name: "Send final quote to customer" });
      await sendQuote.click();
      await expect(card.getByRole("alert")).toContainText("review its latest quote");
      await expect(sendQuote).toBeEnabled();
      await page.unroute(`**${quoteEndpoint}`);
      const issuedResponse = page.waitForResponse(response => response.url().endsWith(quoteEndpoint) && response.request().method() === "POST");
      await sendQuote.click();
      const issued = await issuedResponse;
      expect(issued.status()).toBe(201);
      const issuedBody = (await issued.json()).data;
      expect(Number(issuedBody.quote.totalBdt)).toBe(1060);
      expect(issuedBody.approvalRequired).toBe(true);
      await expect(card.getByText("Waiting for customer", { exact: true })).toBeVisible();
      const customer = await browser.newContext({ baseURL, storageState: "e2e/.auth/customer.json" });
      try {
        const customerPage = await customer.newPage();
        await customerPage.goto(`/orders/${credentials.issuance.orderId}`);
        await expect(customerPage.getByText("Synthetic browser-issued shipping quote.", { exact: true })).toBeVisible();
        await expect(customerPage.getByRole("button", { name: "Accept shipping quote", exact: true })).toBeVisible();
        expect((await customer.request.post(quoteEndpoint, { headers: { Origin: baseURL! }, data: {} })).status()).toBe(403);
      } finally { await customer.close(); }
      // Never attach MFA secrets, recovery-code screens or session cookies.
      const login = await returning.request.post("/api/v1/auth/login", { headers: { Origin: baseURL! }, data: { ...credentials, portal: "admin" } });
      expect(login.status()).toBe(200);
      expect((await login.json()).data.nextAction).toBe("MFA_CHALLENGE");
      expect((await returning.request.get("/api/v1/admin/users")).status()).toBe(403);
      const challenge = await returning.newPage();
      await challenge.goto("/security/mfa");
      await challenge.getByLabel("Authenticator or recovery code").fill(codes[0]);
      await challenge.route("**/api/v1/auth/mfa/verify", route => route.abort("failed"));
      await challenge.getByRole("button", { name: "Verify and continue" }).click();
      await expect(challenge.locator(".mfa-card").getByRole("alert")).toContainText("Check your connection");
      await expect(challenge.getByRole("button", { name: "Verify and continue" })).toBeEnabled();
      await challenge.unroute("**/api/v1/auth/mfa/verify");
      const verified = challenge.waitForResponse(response => response.url().endsWith("/auth/mfa/verify") && response.request().method() === "POST");
      await challenge.getByRole("button", { name: "Verify and continue" }).click();
      expect((await verified).status()).toBe(200);
      expect((await returning.request.get("/api/v1/admin/users")).status()).toBe(200);
      await returning.request.post("/api/v1/auth/logout", { headers: { Origin: baseURL! } });
      await returning.request.post("/api/v1/auth/login", { headers: { Origin: baseURL! }, data: { ...credentials, portal: "admin" } });
      const replay = await returning.request.post("/api/v1/auth/mfa/verify", { headers: { Origin: baseURL! }, data: { code: codes[0] } });
      expect(replay.status()).toBe(401);
      expect((await returning.request.get("/api/v1/admin/users")).status()).toBe(403);
      expect(hydrationWarnings).toEqual([]);
    } finally {
      const cleanup = await Promise.allSettled([context, returning].map(async session => {
        try { await session.request.post("/api/v1/auth/logout", { headers: { Origin: baseURL! }, timeout: 5_000 }); }
        finally { await session.close(); }
      }));
      if (cleanup.some(result => result.status === "rejected")) {
        if (test.info().errors.length === 0) throw new Error("Admin session cleanup failed.");
        console.warn("Admin cleanup also failed; preserving the original test failure.");
      }
    }
  });
});

test.describe("privileged officer MFA boundaries", () => {
  test.describe.configure({ retries: 0 });
  for (const portal of ["finance", "compliance"]) {
    test(`${portal} enrollment grants only its protected tools`, async ({ browser, baseURL }) => {
      test.skip(!process.env.E2E_PRIVILEGED, "Requires disposable privileged officers.");
      test.setTimeout(90_000);
      const accounts = JSON.parse(process.env.E2E_PRIVILEGED!) as { portal: string; email: string; password: string }[];
      const account = accounts.find(item => item.portal === portal)!;
      const ownEndpoint = portal === "finance" ? "/api/v1/finance/payment-reconciliation" : "/api/v1/compliance/screenings";
      const otherEndpoint = portal === "finance" ? "/api/v1/compliance/screenings" : "/api/v1/finance/payment-reconciliation";
      const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
      try {
        const login = await context.request.post("/api/v1/auth/login", { headers: { Origin: baseURL! }, data: account });
        expect(login.status()).toBe(200);
        expect((await login.json()).data.nextAction).toBe("MFA_ENROLLMENT");
        expect((await context.request.get(ownEndpoint)).status()).toBe(403);
        const page = await context.newPage();
        const setupResponse = page.waitForResponse(response => response.url().endsWith("/auth/mfa/setup") && response.request().method() === "POST");
        await page.goto("/security/mfa");
        const setup = await setupResponse;
        expect(setup.status()).toBe(200);
        const secret = (await setup.json()).data.secret as string;
        await page.getByLabel("6-digit code", { exact: true }).fill(authenticatorCode(secret));
        await page.getByRole("button", { name: "Enable and continue" }).click();
        await expect(page.getByRole("heading", { name: "Recovery codes", exact: true })).toBeVisible();
        expect((await context.request.get(ownEndpoint)).status()).toBe(200);
        expect((await context.request.get(otherEndpoint)).status()).toBe(403);
        expect((await context.request.get("/api/v1/admin/users")).status()).toBe(403);
        await page.getByRole("button", { name: "I saved them — continue" }).click();
        await expect(page).toHaveURL(new RegExp(`/${portal}$`), { timeout: 30_000 });
        await expect(page.locator("h1")).toBeVisible();
        if (process.env.E2E_SCREENINGS) {
          const cases = JSON.parse(process.env.E2E_SCREENINGS) as { id: string; decision: string }[];
          if (portal === "finance") {
            const denied = await context.request.patch(`/api/v1/compliance/screenings/${cases[0].id}`, { headers: { Origin: baseURL! }, data: { decision: "APPROVED", note: "Unauthorized finance review.", version: 1 } });
            expect(denied.status()).toBe(403);
          } else {
            for (const item of cases) {
              const endpoint = `/api/v1/compliance/screenings/${item.id}`;
              const invalid = await context.request.patch(endpoint, { headers: { Origin: baseURL! }, data: { decision: item.decision, note: "", version: 1 } });
              expect(invalid.status()).toBe(422);
              const stale = await context.request.patch(endpoint, { headers: { Origin: baseURL! }, data: { decision: item.decision, note: "Synthetic stale review.", version: 2 } });
              expect(stale.status()).toBe(409);
              expect((await stale.json()).error.code).toBe("SCREENING_VERSION_CONFLICT");
              const card = page.locator("article").filter({ hasText: `BROWSER_${item.decision}` });
              await card.getByLabel("Decision", { exact: true }).selectOption(item.decision);
              await card.getByLabel("Review note", { exact: true }).fill("Synthetic evidence checked for this exact screening.");
              if (item.decision === "APPROVED") {
                await page.route(`**${endpoint}`, route => route.abort("failed"));
                await card.getByRole("button", { name: "Record decision", exact: true }).click();
                await expect(card.getByText("Could not confirm this decision. Refresh the queue and review the case before retrying.", { exact: true })).toBeVisible();
                await expect(card.getByRole("button", { name: "Record decision", exact: true })).toBeEnabled();
                await page.unroute(`**${endpoint}`);
              }
              const decided = page.waitForResponse(response => response.url().endsWith(endpoint) && response.request().method() === "PATCH");
              await card.getByRole("button", { name: "Record decision", exact: true }).click();
              const response = await decided;
              expect(response.status()).toBe(200);
              expect((await response.json()).data.screening.outcome).toBe(item.decision);
              await expect(card).toHaveCount(0);
              const repeat = await context.request.patch(endpoint, { headers: { Origin: baseURL! }, data: { decision: item.decision, note: "Repeated decision must not mutate.", version: 1 } });
              expect(repeat.status()).toBe(409);
            }
          }
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
      } finally {
        try { await context.request.post("/api/v1/auth/logout", { headers: { Origin: baseURL! } }); }
        finally { await context.close(); }
      }
    });
  }
});

test.describe("synthetic shipping wallet settlement", () => {
  test.describe.configure({ retries: 0 });
  test("debits once, retries safely and rejects insufficient funds", async ({ browser, baseURL }) => {
    test.skip(!process.env.E2E_PAYMENTS, "Requires disposable wallet and measured orders.");
    const [orderId, insufficientOrderId] = JSON.parse(process.env.E2E_PAYMENTS!) as string[];
    const customer = await browser.newContext({ baseURL, storageState: "e2e/.auth/customer.json", viewport: { width: 390, height: 844 } });
    try {
      const page = await customer.newPage();
      await page.goto(`/orders/${orderId}`);
      const endpoint = "/api/v1/payments/shipping/wallet";
      const pay = page.getByRole("button", { name: "Pay shipping from wallet", exact: true });
      await expect(pay).toBeEnabled();
      let firstKey: string | undefined;
      await page.route(`**${endpoint}`, route => {
        firstKey = route.request().headers()["idempotency-key"];
        return route.abort("failed");
      });
      await pay.click();
      await expect(page.getByText("Shipping payment could not be confirmed. Check your connection and retry safely.", { exact: true })).toBeVisible();
      await expect(pay).toBeEnabled();
      await page.unroute(`**${endpoint}`);
      const paymentResponse = page.waitForResponse(response => response.url().endsWith(endpoint) && response.request().method() === "POST");
      await pay.click();
      const response = await paymentResponse;
      expect(response.status()).toBe(201);
      const key = response.request().headers()["idempotency-key"];
      expect(key).toBe(firstKey);
      expect((await response.json()).data.shippingPayment.status).toBe("SUCCEEDED");
      await expect(page.getByText("✓ Shipping payment completed. Your package is ready for dispatch.", { exact: true })).toBeVisible();
      const headers = { Origin: baseURL!, "Idempotency-Key": key };
      const replay = await customer.request.post(endpoint, { headers, data: { orderId } });
      expect(replay.status()).toBe(200);
      expect((await replay.json()).data.idempotentReplay).toBe(true);
      const changedPayload = await customer.request.post(endpoint, { headers, data: { orderId: insufficientOrderId } });
      expect(changedPayload.status()).toBe(409);
      expect((await changedPayload.json()).error.code).toBe("IDEMPOTENCY_KEY_REUSED");
      await page.goto(`/orders/${insufficientOrderId}`);
      await expect(pay).toBeDisabled();
      const insufficient = await customer.request.post(endpoint, { headers: { Origin: baseURL!, "Idempotency-Key": "browser-insufficient-shipping-funds" }, data: { orderId: insufficientOrderId } });
      expect(insufficient.status()).toBe(409);
      expect((await insufficient.json()).error.code).toBe("INSUFFICIENT_WALLET_BALANCE");
      const timeline = (await (await customer.request.get(`/api/v1/orders/${orderId}/timeline`)).json()).data.order;
      expect(timeline.status).toBe("READY_TO_SHIP");
      expect(timeline.statusHistory).toHaveLength(1);
    } finally { await customer.close(); }
  });
});

test.describe("customer shipping quote decisions", () => {
  test.describe.configure({ retries: 0 });
  for (const action of ["accept", "reject", "expired"]) {
    test(`${action} measured quote safely`, async ({ browser, baseURL }) => {
      test.skip(!process.env.E2E_QUOTES, "Requires disposable measured quotes.");
      const fixtures = JSON.parse(process.env.E2E_QUOTES!) as { action: string; orderId: string }[];
      const fixture = fixtures.find(item => item.action === action)!;
      const customer = await browser.newContext({ baseURL, storageState: "e2e/.auth/customer.json", viewport: { width: 390, height: 844 } });
      const employee = await browser.newContext({ baseURL, storageState: "e2e/.auth/inspector.json" });
      try {
        const endpoint = `/api/v1/orders/${fixture.orderId}/shipping-quote/${action === "expired" ? "accept" : action}`;
        expect((await employee.request.post(endpoint, { headers: { Origin: baseURL!, "Idempotency-Key": `browser-foreign-quote-${action}` } })).status()).toBe(404);
        const page = await customer.newPage();
        await page.goto(`/orders/${fixture.orderId}`);
        await expect(page.getByRole("heading", { name: "Review the measured shipping amount" })).toBeVisible();
        if (action === "accept") {
          await page.route(`**${endpoint}`, route => route.abort("failed"));
          await page.getByRole("button", { name: "Accept shipping quote", exact: true }).click();
          await expect(page.locator(".shipping-quote-card").getByRole("alert")).toContainText("Check your connection");
          await expect(page.getByRole("button", { name: "Accept shipping quote", exact: true })).toBeEnabled();
          await page.unroute(`**${endpoint}`);
        }
        if (action === "reject") page.once("dialog", dialog => dialog.accept());
        const decision = page.waitForResponse(response => response.url().endsWith(endpoint) && response.request().method() === "POST");
        await page.getByRole("button", { name: action === "reject" ? "Do not proceed with shipping" : "Accept shipping quote", exact: true }).click();
        const response = await decision;
        expect(response.status()).toBe(action === "expired" ? 409 : 200);
        if (action === "expired") {
          await expect(page.locator(".shipping-quote-card").getByRole("alert")).toContainText("expired");
          await page.reload();
          await expect(page.getByText("This quote has expired. Please request an updated shipping quote.", { exact: true })).toBeVisible();
        } else {
          const key = response.request().headers()["idempotency-key"];
          const replay = await customer.request.post(endpoint, { headers: { Origin: baseURL!, "Idempotency-Key": key } });
          expect(replay.status()).toBe(200);
          expect((await replay.json()).data.idempotentReplay).toBe(true);
          const timeline = (await (await customer.request.get(`/api/v1/orders/${fixture.orderId}/timeline`)).json()).data.order;
          expect(timeline.status).toBe(action === "accept" ? "SHIPPING_QUOTE_READY" : "ON_HOLD");
          expect(timeline.statusHistory).toHaveLength(1);
          if (action === "accept") await expect(page.getByRole("button", { name: "Pay shipping from wallet" })).toBeVisible();
          else await expect(page.getByText("Shipping is on hold because you declined this quote. Your product order remains recorded.", { exact: true })).toBeVisible();
        }
      } finally { await Promise.all([customer.close(), employee.close()]); }
    });
  }
});

const portals = [
  { portal: "warehouse", path: "/warehouse", heading: "Good work starts with a scan.", other: "logistics" },
  { portal: "inspector", path: "/inspector", heading: "Quality decisions begin with a scan.", other: "warehouse" },
  { portal: "logistics", path: "/logistics", heading: "Every handoff becomes a trusted update.", other: "inspector" },
  { portal: "support", path: "/support/tickets", heading: "Protect context. Resolve clearly.", other: "warehouse" },
];

for (const employee of portals) {
  test.describe(employee.portal, () => {
    test.skip(!process.env.E2E_STAFF_ACCOUNTS, "Requires disposable employee fixtures.");
    test.use({ storageState: process.env.E2E_STAFF_ACCOUNTS ? `e2e/.auth/${employee.portal}.json` : undefined });
    test("desktop portal and assignment boundary", async ({ page }) => {
      await page.goto(employee.path);
      await expect(page.getByRole("heading", { name: employee.heading, exact: true })).toBeVisible();
      if (employee.portal !== "support") {
        await expect(page.getByText(/^Assigned browser station/).first()).toBeVisible();
        await expect(page.getByText(/^Unassigned browser station/)).toHaveCount(0);
      }
      expect((await page.request.get("/api/v1/admin/audit-logs")).status()).toBe(403);
    });
    test("mobile layout and wrong-portal denial", async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(employee.path);
      await expect(page.getByRole("heading", { name: employee.heading, exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
      await page.goto(`/${employee.other}`);
      await expect(page).toHaveURL(new RegExp(`/${employee.other}/login(?:\\?|$)`));
    });
  });
}

test.describe("warehouse handoff workflow", () => {
  // A mutation scenario must not reuse partially processed records on retry.
  test.describe.configure({ retries: 0 });
  test("receipt, inspection, measurement and customer timeline", async ({ browser, baseURL }) => {
    test.skip(!process.env.E2E_WORKFLOW, "Requires an isolated operational fixture.");
    test.setTimeout(120_000);
    const fixture = JSON.parse(process.env.E2E_WORKFLOW!) as { orderId: string; orderNumber: string; locationId: string; warehouseId: string; raceOrderNumber: string; inboundOrderNumber: string; inboundPackages: { packageCode: string; inboundTracking: string }[] };
    const worker = await browser.newContext({ baseURL, storageState: "e2e/.auth/warehouse.json", viewport: { width: 390, height: 844 } });
    const inspector = await browser.newContext({ baseURL, storageState: "e2e/.auth/inspector.json", viewport: { width: 390, height: 844 } });
    const customer = await browser.newContext({ baseURL, storageState: "e2e/.auth/customer.json" });
    try {
      const page = await worker.newPage();
      const receiptEndpoint = "/api/v1/operations/packages/receive";
      const racePayload = { orderNumber: fixture.raceOrderNumber, warehouseId: fixture.warehouseId, inboundTracking: "" };
      const races = await Promise.all(["a", "b"].map(suffix => worker.request.post(receiptEndpoint, { headers: { Origin: baseURL!, "Idempotency-Key": `receipt-race-${suffix}-${fixture.raceOrderNumber}` }, data: racePayload })));
      expect(races.map(response => response.status()).sort()).toEqual([201, 409]);
      for (const [index, expected] of fixture.inboundPackages.entries()) {
        const expectedPayload = { orderNumber: fixture.inboundOrderNumber, warehouseId: fixture.warehouseId, packageCode: expected.packageCode, inboundTracking: "" };
        const expectedHeaders = { Origin: baseURL!, "Idempotency-Key": `expected-parcel-${expected.packageCode}` };
        expect((await worker.request.post(receiptEndpoint, { headers: expectedHeaders, data: { ...expectedPayload, inboundTracking: "does-not-match" } })).status()).toBe(409);
        await page.goto(`/warehouse/packages/${expected.packageCode}`);
        const expectedResponse = page.waitForResponse(response => response.url().endsWith(receiptEndpoint) && response.request().method() === "POST");
        await page.getByRole("button", { name: "Confirm package received" }).click();
        const receivedExpected = await expectedResponse;
        expect(receivedExpected.status()).toBe(201);
        expect((await receivedExpected.json()).data.package.packageCode).toBe(expected.packageCode);
        expect(receivedExpected.request().postDataJSON().packageCode).toBe(expected.packageCode);
        const expectedReplay = await worker.request.post(receiptEndpoint, { headers: { Origin: baseURL!, "Idempotency-Key": receivedExpected.request().headers()["idempotency-key"] }, data: receivedExpected.request().postDataJSON() });
        expect(expectedReplay.status()).toBe(200);
        expect((await expectedReplay.json()).data.idempotentReplay).toBe(true);
        await expect(page.getByText("Waiting for Inspector", { exact: true })).toBeVisible();
        if (index === 0) expect((await worker.request.post(receiptEndpoint, { headers: { ...expectedHeaders, "Idempotency-Key": `duplicate-parcel-${expected.packageCode}` }, data: expectedPayload })).status()).toBe(409);
      }
      await page.goto("/warehouse/scan");
      await page.getByLabel("Package, order, or inbound tracking code").fill(fixture.orderNumber);
      await page.getByRole("button", { name: "Open task", exact: true }).click();
      await page.route(`**${receiptEndpoint}`, route => route.abort("failed"));
      await page.getByRole("button", { name: "Confirm package received" }).click();
      await expect(page.getByRole("alert").filter({ hasText: "may already have been saved" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Confirm package received" })).toBeEnabled();
      await page.unroute(`**${receiptEndpoint}`);
      const received = page.waitForResponse(response => response.url().endsWith("/operations/packages/receive") && response.request().method() === "POST");
      await page.getByRole("button", { name: "Confirm package received" }).click();
      const receipt = await received;
      expect(receipt.status()).toBe(201);
      const pkg = (await receipt.json()).data.package as { id: string; packageCode: string };
      const receiptPayload = receipt.request().postDataJSON();
      const receiptHeaders = { Origin: baseURL!, "Idempotency-Key": receipt.request().headers()["idempotency-key"] };
      const replay = await worker.request.post(receiptEndpoint, { headers: receiptHeaders, data: receiptPayload });
      expect(replay.status()).toBe(200);
      expect((await replay.json()).data.package.id).toBe(pkg.id);
      for (const changed of [{ orderNumber: fixture.raceOrderNumber }, { inboundTracking: "changed-parcel" }, { warehouseId: "11111111-1111-4111-8111-111111111111" }]) {
        const conflict = await worker.request.post(receiptEndpoint, { headers: receiptHeaders, data: { ...receiptPayload, ...changed } });
        expect(conflict.status()).toBe(409);
        expect((await conflict.json()).error.code).toBe("IDEMPOTENCY_KEY_CONFLICT");
      }
      expect((await worker.request.post(receiptEndpoint, { headers: receiptHeaders, data: {} })).status()).toBe(422);
      expect((await inspector.request.post(receiptEndpoint, { headers: receiptHeaders, data: receiptPayload })).status()).toBe(403);
      // The receipt API finishes before Next compiles and navigates to this page.
      await expect(page).toHaveURL(new RegExp(`/warehouse/packages/${pkg.packageCode}$`), { timeout: 30_000 });
      await expect(page.getByText("Waiting for Inspector", { exact: true })).toBeVisible({ timeout: 30_000 });
      expect((await worker.request.post(`/api/v1/operations/packages/${pkg.id}/inspect`, { headers: { Origin: baseURL! }, data: { type: "BASIC", result: "PASSED" } })).status()).toBe(403);
      const inspectionPage = await inspector.newPage();
      await inspectionPage.goto(`/inspector/packages/${pkg.packageCode}`);
      await inspectionPage.getByLabel("3. Inspection notes").fill("Synthetic test: packaging and quantity checked.");
      const inspectEndpoint = `/api/v1/operations/packages/${pkg.id}/inspect`;
      const inspectionPayload = { type: "BASIC", result: "PASSED", notes: "Synthetic test: packaging and quantity checked." };
      expect((await inspector.request.post(inspectEndpoint, { headers: { Origin: baseURL! }, data: inspectionPayload })).status()).toBe(422);
      expect((await inspector.request.post(inspectEndpoint, { headers: { Origin: "https://untrusted.example.test", "Idempotency-Key": `inspection-origin-${pkg.id}` }, data: inspectionPayload })).status()).toBe(403);
      expect((await inspector.request.post(inspectEndpoint, { headers: { Origin: baseURL!, "Idempotency-Key": `inspection-malformed-${pkg.id}` }, data: { ...inspectionPayload, qcStatus: "PASSED" } })).status()).toBe(422);
      let firstInspectionKey = "";
      await inspectionPage.route(`**${inspectEndpoint}`, async route => {
        firstInspectionKey = route.request().headers()["idempotency-key"];
        const committed = await route.fetch();
        expect(committed.status()).toBe(201);
        await route.abort("failed"); // Server saved; response was lost.
      });
      await inspectionPage.getByRole("button", { name: "Complete inspection" }).click();
      await expect(inspectionPage.getByRole("alert").filter({ hasText: "may already have been saved" })).toBeVisible();
      await inspectionPage.unroute(`**${inspectEndpoint}`);
      const inspected = inspectionPage.waitForResponse(response => response.url().endsWith(`/packages/${pkg.id}/inspect`) && response.request().method() === "POST");
      await inspectionPage.getByRole("button", { name: "Complete inspection" }).click();
      const confirmedInspection = await inspected;
      expect(confirmedInspection.status()).toBe(200);
      expect(confirmedInspection.request().headers()["idempotency-key"]).toBe(firstInspectionKey);
      const inspectionData = (await confirmedInspection.json()).data;
      expect(inspectionData.idempotentReplay).toBe(true);
      expect(inspectionData.inspection.requestFingerprint).toBeUndefined();
      expect(inspectionData.inspection.idempotencyKey).toBeUndefined();
      const replayHeaders = { Origin: baseURL!, "Idempotency-Key": firstInspectionKey };
      expect((await inspector.request.post(inspectEndpoint, { headers: replayHeaders, data: { ...inspectionPayload, notes: "Different details" } })).status()).toBe(409);
      expect((await inspector.request.post(inspectEndpoint, { headers: replayHeaders, data: {} })).status()).toBe(422);
      expect((await inspector.request.post(inspectEndpoint, { headers: { ...replayHeaders, "Idempotency-Key": `different-inspection-${pkg.id}` }, data: inspectionPayload })).status()).toBe(409);
      // Saving finishes before the Server Component refresh; cold development
      // compilation can exceed the default assertion timeout. Never resubmit.
      await expect(inspectionPage.getByRole("heading", { name: "Inspection completed" })).toBeVisible({ timeout: 30_000 });
      await page.reload();
      await page.getByLabel("Actual weight (g)").fill("1200");
      await page.getByLabel("Length (mm)").fill("400");
      await page.getByLabel("Width (mm)").fill("300");
      await page.getByLabel("Height (mm)").fill("200");
      const measured = page.waitForResponse(response => response.url().endsWith(`/packages/${pkg.id}/measure`) && response.request().method() === "POST");
      await page.getByRole("button", { name: "Save measurement" }).click();
      expect((await measured).status()).toBe(200);
      await page.getByLabel("Zone, shelf, bin, or staging area").selectOption(fixture.locationId);
      const stored = page.waitForResponse(response => response.url().endsWith(`/packages/${pkg.id}/put-away`) && response.request().method() === "POST");
      await page.getByRole("button", { name: "Confirm put-away" }).click();
      expect((await stored).status()).toBe(200);
      await expect(page.getByText("Put away", { exact: true })).toBeVisible();
      const timeline = await customer.request.get(`/api/v1/orders/${fixture.orderId}/timeline`);
      expect(timeline.status()).toBe(200);
      const order = (await timeline.json()).data.order;
      expect(order.status).toBe("MEASURED");
      expect(order.statusHistory.map((event: { toStatus: string }) => event.toStatus)).toEqual(["WAREHOUSE_RECEIVED", "INSPECTION", "MEASURED"]);
      expect((await inspector.request.get(`/api/v1/orders/${fixture.orderId}/timeline`)).status()).toBe(403);
    } finally { await Promise.all([worker.close(), inspector.close(), customer.close()]); }
  });
});

test.describe("shipment tracking workflow", () => {
  test.describe.configure({ retries: 0 });
  test("publishes every stage through delivery and synchronizes customer tracking", async ({ browser, baseURL }) => {
    test.skip(!process.env.E2E_DELIVERY, "Requires a disposable post-payment shipment fixture.");
    test.setTimeout(120_000);
    const fixture = JSON.parse(process.env.E2E_DELIVERY!) as { orderId: string; shipmentId: string; trackingNumber: string };
    const logistics = await browser.newContext({ baseURL, storageState: "e2e/.auth/logistics.json", viewport: { width: 390, height: 844 } });
    const customer = await browser.newContext({ baseURL, storageState: "e2e/.auth/customer.json" });
    try {
      const page = await logistics.newPage();
      await page.goto(`/logistics/shipments/${fixture.trackingNumber}`);
      const endpoint = `/api/v1/operations/shipments/${fixture.shipmentId}/events`;
      const headers = { Origin: baseURL!, "Idempotency-Key": "browser-invalid-transition-check" };
      expect((await logistics.request.post(endpoint, { headers, data: { status: "DELIVERED", location: "Demo hub", recipientName: "Test recipient", proofReference: "delivery-evidence/browser/demo.jpg" } })).status()).toBe(409);
      const stages = ["PICKUP_PENDING", "PICKED_UP", "ORIGIN_WAREHOUSE", "CONSOLIDATED", "READY_FOR_EXPORT", "DEPARTED_ORIGIN", "IN_TRANSIT", "DESTINATION_ARRIVAL", "CUSTOMS", "CUSTOMS_CLEARED", "DESTINATION_WAREHOUSE", "OUT_FOR_DELIVERY", "DELIVERED"];
      for (const status of stages) {
        await expect(page.getByLabel("Next status").locator(`option[value="${status}"]`)).toHaveCount(1);
        await page.getByLabel("Next status").selectOption(status);
        await page.getByLabel("Current location").fill("Synthetic test hub");
        await page.getByLabel("Update description").fill(`Synthetic ${status} confirmation.`);
        if (status === "DELIVERED") {
          expect((await logistics.request.post(endpoint, { headers: { Origin: baseURL!, "Idempotency-Key": "browser-missing-delivery-evidence" }, data: { status, location: "Demo hub" } })).status()).toBe(422);
          await page.getByLabel("Recipient name").fill("Test recipient");
          // Demo reference tests the existing contract, not physical evidence storage.
          await page.getByLabel("Approved proof-of-delivery reference").fill("delivery-evidence/browser/demo.jpg");
        }
        const published = page.waitForResponse(response => response.url().endsWith(`/shipments/${fixture.shipmentId}/events`) && response.request().method() === "POST");
        await page.getByRole("button", { name: "Publish immutable update" }).click();
        const response = await published;
        expect(response.status()).toBe(200);
        const result = (await response.json()).data.shipment;
        expect(result.status).toBe(status);
        if (status === "DELIVERED") expect(new Date(result.claimDeadline).getTime() - new Date(result.deliveredAt).getTime()).toBe(7 * 24 * 60 * 60 * 1000);
        // One transport-only retry is safe for this read; never replay mutations.
        const timelineResponse = await customer.request.get(`/api/v1/orders/${fixture.orderId}/timeline`, { maxRetries: 1 });
        expect(timelineResponse.status()).toBe(200);
        const order = (await timelineResponse.json()).data.order;
        const shipment = order.packages[0].shipmentPackages[0].shipment;
        expect(shipment.status).toBe(status);
        expect(shipment.events.map((event: { status: string }) => event.status)).toEqual(stages.slice(0, stages.indexOf(status) + 1));
        if (status === "DELIVERED") expect(order.status).toBe("DELIVERED");
      }
      await expect(page.getByText("No further Logistics transition is available.", { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    } finally { await Promise.all([logistics.close(), customer.close()]); }
  });
});
