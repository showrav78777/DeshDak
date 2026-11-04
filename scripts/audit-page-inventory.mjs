import { readdir } from "node:fs/promises";
import { relative, join } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = fileURLToPath(new URL("../src/app/", import.meta.url));
async function pages(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.filter(entry => entry.isDirectory()).map(entry => pages(join(directory, entry.name))));
  return [...entries.filter(entry => entry.isFile() && /^page\.(?:tsx|jsx|ts|js)$/.test(entry.name)).map(entry => join(directory, entry.name)), ...nested.flat()];
}
const employeePortals = new Set(["admin", "warehouse", "inspector", "logistics", "finance", "compliance", "sourcing", "support", "sales", "seller"]);
const routes = (await pages(appRoot)).map(file => {
  const segments = relative(appRoot, file).split("/").slice(0, -1).filter(segment => !/^\(.*\)$/.test(segment) && !segment.startsWith("@"));
  const route = `/${segments.join("/")}`;
  return {
    route,
    source: `src/app/${relative(appRoot, file)}`,
    area: employeePortals.has(segments[0]) ? segments[0] : "customer-public",
    needsFixture: segments.some(segment => segment.includes("[")),
    workflowReview: "NOT_REVIEWED",
    desktopReview: "NOT_REVIEWED",
    mobileReview: "NOT_REVIEWED",
  };
}).sort((a, b) => a.route.localeCompare(b.route));
console.log(JSON.stringify({
  scope: "Source inventory only. Route existence is not workflow, authorization or UI acceptance evidence.",
  total: routes.length,
  staticRoutes: routes.filter(route => !route.needsFixture).length,
  fixtureRoutes: routes.filter(route => route.needsFixture).length,
  routes,
}, null, 2));
