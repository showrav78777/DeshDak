import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";

export async function verifyInspectionCapture({ origin, pkg, inspectorCookie, workerCookie, capabilities }) {
  for (const cookie of [inspectorCookie, workerCookie]) {
    const response = await fetch(`${origin}/api/v1/operations/packages/${pkg.id}/inspection-evidence`, { headers: { Cookie: `crossly_session=${cookie}; __Host-crossly_session=${cookie}` } });
    assert.equal(response.status, 200);
    assert(response.headers.get("cache-control").includes("no-store"));
    const body = await response.json();
    assert.deepEqual(body.data.uploads, capabilities);
  }
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [portal, cookie, width] of [["inspector", inspectorCookie, 1440], ["warehouse", workerCookie, 390]]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } });
      await context.addCookies([{ name: "crossly_session", value: cookie, url: origin }]);
      const page = await context.newPage();
      let mode = "loading", release;
      const loading = new Promise(resolve => { release = resolve; });
      let posts = 0;
      await page.route(`**/api/v1/operations/packages/${pkg.id}/inspection-evidence`, async route => {
        if (route.request().method() !== "GET") { posts++; await route.abort(); return; }
        if (mode === "loading") await loading;
        if (mode === "error") { await route.fulfill({ status: 503, json: { error: { code: "UNAVAILABLE" } } }); return; }
        const uploads = { photos: mode !== "unavailable", videos: mode === "development", maxPhotoBytes: 8388608, maxVideoBytes: 31457280, mode: mode === "development" ? "DEVELOPMENT" : mode === "unavailable" ? "UNAVAILABLE" : "PRIVATE_PHOTOS" };
        await route.fulfill({ json: { data: { evidence: mode === "review" ? [{ id: pkg.id, mediaKind: "PHOTO", createdAt: new Date().toISOString(), availableForInspection: false }] : [], uploads: mode === "malformed" ? {} : uploads } } });
      });
      try {
        await page.goto(`${origin}/${portal}/packages/${pkg.packageCode}`, { waitUntil: "domcontentloaded" });
        await expect(page.getByText("Checking available evidence uploads…")).toBeVisible();
        await expect(page.getByLabel("Take a photo", { exact: true })).toBeDisabled();
        mode = "photos"; release();
        await expect(page.getByLabel("Take a photo", { exact: true })).toBeEnabled();
        assert.equal(await page.getByLabel("Record a video", { exact: true }).count(), 0);
        assert.equal((await page.getByLabel("Choose from device", { exact: true }).getAttribute("accept")).includes("video"), false);
        await page.getByLabel("Choose from device", { exact: true }).setInputFiles({ name: "synthetic.mp4", mimeType: "video/mp4", buffer: Buffer.from("SYNTHETIC_UNSUPPORTED_VIDEO") });
        await expect(page.getByText("This evidence upload option is unavailable. Refresh before trying again.")).toBeVisible();
        assert.equal(posts, 0, "Unsupported video must not be sent to the server");
        for (const failure of ["error", "malformed"]) {
          mode = failure; await page.reload();
          await expect(page.getByRole("button", { name: "Retry upload options" })).toBeVisible();
          await expect(page.getByLabel("Take a photo", { exact: true })).toBeDisabled();
          mode = "photos"; await page.getByRole("button", { name: "Retry upload options" }).click();
          await expect(page.getByLabel("Take a photo", { exact: true })).toBeEnabled();
        }
        mode = "unavailable"; await page.reload();
        await expect(page.getByText("Secure evidence uploads are unavailable. Contact the administrator before capturing files.")).toBeVisible();
        await expect(page.getByLabel("Take a photo", { exact: true })).toBeDisabled();
        if (portal === "inspector") {
          mode = "review"; await page.reload();
          await expect(page.getByText("Evidence unavailable or under safety review")).toBeVisible();
          await expect(page.getByRole("button", { name: "Use this photo" })).toBeDisabled();
          assert.equal(await page.getByRole("link", { name: "View photo", exact: true }).count(), 0);
        }
        mode = "development"; await page.reload();
        await expect(page.getByLabel("Record a video", { exact: true })).toBeEnabled();
        mode = "photos"; await page.reload();
        await expect(page.getByLabel("Take a photo", { exact: true })).toBeEnabled();
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        await page.screenshot({ path: `/tmp/deshdak-inspection-upload-${portal}-${width}-20261124.png`, fullPage: true });
        assert.equal(posts, 0);
      } finally { release(); await context.close(); }
    }
  } finally { await browser.close(); }
  console.log("Inspection capture availability passed: actual assigned-staff API, bounded non-secret capabilities, desktop/mobile loading, unavailable/malformed/error retry, supported file picker, no unsupported video POST and explicit development-only video. UI responses simulated; server authorization remains real.");
}
