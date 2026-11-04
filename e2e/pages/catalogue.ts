import { expect, type Page } from "@playwright/test";

export class CataloguePage {
  constructor(readonly page: Page) {}
  async open(query = "") {
    await this.page.goto(`/products${query}`);
    await expect(this.page.getByRole("heading", { name: "Browse before you sign in.", exact: true })).toBeVisible();
  }
  async sort(value: "price_asc" | "price_desc" | "name_asc") {
    await expect(this.page.getByRole("combobox", { name: "Sort products", exact: true })).toBeEnabled();
    await this.page.getByRole("combobox", { name: "Sort products", exact: true }).selectOption(value);
    await expect(this.page).toHaveURL(new RegExp(`sort=${value}`));
  }
  async assertFitsScreen() {
    const sizes = await this.page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
    expect(sizes.content).toBeLessThanOrEqual(sizes.viewport);
  }
}
