import { test as base, expect } from "@playwright/test";
import { CataloguePage } from "./pages/catalogue";

export const test = base.extend<{ catalogue: CataloguePage }>({
  page: async ({ page }, provide) => {
    // This is presentation isolation, not evidence of a live advertising service.
    await page.route("**/api/v1/advertisements?**", (route) => route.fulfill({ json: { data: { advertisements: [] } } }));
    await provide(page);
  },
  catalogue: async ({ page }, provide) => { await provide(new CataloguePage(page)); },
});
export { expect };
