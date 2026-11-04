import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "@playwright/test";
import { renderBarcodeSvg } from "../src/modules/identifiers/assets.ts";

// Render the real component and stylesheet without a database or private order.
const filename = new URL("../src/components/identifier-panel.tsx", import.meta.url);
const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
const exported = {};
vm.runInNewContext(compiled, { exports: exported, require: createRequire(filename) }, { filename: filename.pathname });
const code = "ORD-ABCDEF0123456789ABCD";
const markup = renderToStaticMarkup(React.createElement(exported.IdentifierPanel, { entity: "order", code, title: "Test identifiers" }));
assert.match(markup, /data-nimg="fill"/, "Barcode must use a sized fill container, not mismatched fixed image dimensions.");
const css = readFileSync(new URL("../src/app/identifiers.css", import.meta.url), "utf8");
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.route("https://identifier-layout.test/**", route => route.fulfill({ contentType: "image/svg+xml", body: renderBarcodeSvg(code) }));
  for (const width of [320, 375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.setContent(`<base href="https://identifier-layout.test"><style>*{box-sizing:border-box}body{margin:0}${css}</style>${markup}`);
    const frame = page.locator(".identifier-barcode-image");
    const bounds = await frame.boundingBox();
    assert(bounds && bounds.width > 0 && bounds.width <= 430);
    assert(Math.abs(bounds.width / bounds.height - 4.3) < 0.02, `Incorrect barcode frame ratio at ${width}px`);
    assert(await frame.locator("img").evaluate(img => img.complete && img.naturalWidth > 0 && getComputedStyle(img).objectFit === "contain"));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow at ${width}px`);
  }
  await page.setContent(`<base href="https://identifier-layout.test"><style>*{box-sizing:border-box}${css}</style><div class="identifier-print-page"><div class="identifier-print-sheet">${markup}</div></div>`);
  await page.emulateMedia({ media: "print" });
  const bounds = await page.locator(".identifier-barcode-image").boundingBox();
  assert(bounds && Math.abs(bounds.width - 70 * 96 / 25.4) < 1 && Math.abs(bounds.height - 18 * 96 / 25.4) < 1, "Print barcode must retain its 70 × 18 mm area.");
  console.log("Identifier layout passed: real component at 320/375/768/1440px, contained SVG, no horizontal overflow, and 70 × 18 mm print area.");
} finally {
  await browser.close();
}
