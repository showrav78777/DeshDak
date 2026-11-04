import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const origin = new URL(process.env.TEST_BASE_URL ?? process.env.APP_BASE_URL ?? "http://localhost:3000").origin;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
let previousInternationalCountry = null;
let createdInternationalCountry = false;
let previousBangladesh = null;
let createdBangladesh = false;

async function post(body) {
  const response = await fetch(`${origin}/api/v1/catalog/market`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body),
    redirect: "manual",
  });
  return { response, body: await response.json() };
}

try {
  previousBangladesh = await prisma.country.findUnique({ where: { isoCode: "BD" } });
  if (previousBangladesh) await prisma.country.update({ where: { isoCode: "BD" }, data: { isActive: true } });
  else {
    await prisma.country.create({ data: { isoCode: "BD", name: "Bangladesh", defaultCurrency: "BDT", defaultLocale: "bn", isActive: true } });
    createdBangladesh = true;
  }
  previousInternationalCountry = await prisma.country.findUnique({ where: { isoCode: "CA" } });
  if (previousInternationalCountry) await prisma.country.update({ where: { isoCode: "CA" }, data: { isActive: true } });
  else {
    await prisma.country.create({ data: { isoCode: "CA", name: "Canada", defaultCurrency: "CAD", defaultLocale: "en", isActive: true } });
    createdInternationalCountry = true;
  }
  const configuredCountries = await prisma.country.findMany({ where: { isActive: true }, select: { isoCode: true, name: true }, orderBy: { name: "asc" } });
  const activeCountries = configuredCountries.some(({ isoCode }) => isoCode === "BD") ? configuredCountries : [{ isoCode: "BD", name: "Bangladesh" }, ...configuredCountries];
  const selected = activeCountries.find(({ isoCode }) => isoCode === "CA");
  assert(selected, "Temporary international market was not activated.");

  const malformed = await post({ countryCode: "invalid" });
  assert(malformed.response.status === 422 && malformed.body.error.code === "VALIDATION_ERROR", "Malformed market country was accepted.");

  const enabledCodes = new Set(activeCountries.map(({ isoCode }) => isoCode));
  const unavailableCode = ["ZZ", "XX", "QZ"].find((code) => !enabledCodes.has(code));
  if (unavailableCode) {
    const unavailable = await post({ countryCode: unavailableCode });
    assert(unavailable.response.status === 409 && unavailable.body.error.code === "MARKET_NOT_AVAILABLE", "An Admin-disabled market was accepted.");
  }

  const saved = await post({ countryCode: selected.isoCode.toLowerCase() });
  assert(saved.response.status === 200 && saved.body.data.market.isoCode === selected.isoCode, "Enabled market preference was not normalized and saved.");
  const setCookie = saved.response.headers.get("set-cookie") ?? "";
  assert(/crossly_market_country=/.test(setCookie) && /HttpOnly/i.test(setCookie) && /SameSite=Strict/i.test(setCookie) && /Path=\//i.test(setCookie), "Market cookie is missing a required security attribute.");
  const cookie = setCookie.split(";", 1)[0];

  const catalog = await fetch(`${origin}/api/v1/catalog/products?pageSize=4`, { headers: { Cookie: cookie } });
  const catalogBody = await catalog.json();
  assert(catalog.status === 200 && catalogBody.data.meta.marketCountry === selected.isoCode, "Catalog did not use the anonymous market cookie.");
  assert((catalog.headers.get("cache-control") ?? "").includes("private") && (catalog.headers.get("cache-control") ?? "").includes("no-store"), "Cookie-personalized catalog response was publicly cacheable.");

  const explicit = await fetch(`${origin}/api/v1/catalog/products?pageSize=1&marketCountry=BD`, { headers: { Cookie: cookie } });
  const explicitBody = await explicit.json();
  assert(explicit.status === 200 && explicitBody.data.meta.marketCountry === "BD" && explicitBody.data.meta.rankingPolicy === "GLOBAL_FIRST", "Explicit mobile/API market did not override the anonymous browser cookie.");

  const page = await fetch(`${origin}/products`, { headers: { Cookie: cookie } });
  const html = await page.text();
  const expectedCopy = selected.isoCode === "BD" ? "Global products prioritized for Bangladesh" : `Products from ${selected.isoCode} prioritized, then global products`;
  assert(page.status === 200 && html.includes(expectedCopy), "Public catalog page did not render the saved anonymous market policy.");

  const homepage = await fetch(origin, { headers: { Cookie: cookie } });
  const homepageHtml = await homepage.text();
  assert(homepage.status === 200 && homepageHtml.includes("BANGLADESH → CA") && homepageHtml.includes("Discover Bangladesh.") && homepageHtml.includes("Explore Bangladesh stores"), "Homepage did not switch to the international-customer experience.");

  if (unavailableCode) {
    const forged = await fetch(`${origin}/api/v1/catalog/products?pageSize=1`, { headers: { Cookie: `crossly_market_country=${unavailableCode}` } });
    const forgedBody = await forged.json();
    assert(forged.status === 200 && forgedBody.data.meta.marketCountry === "BD", "A manually forged disabled-market cookie bypassed Admin country controls.");
  }

  console.log(`Anonymous market preference verification passed for ${selected.name}: enabled-country validation, secure persistence, cache isolation, catalog ranking, and API override.`);
} finally {
  if (createdInternationalCountry) await prisma.country.deleteMany({ where: { isoCode: "CA" } });
  else if (previousInternationalCountry) await prisma.country.update({ where: { isoCode: "CA" }, data: { name: previousInternationalCountry.name, defaultCurrency: previousInternationalCountry.defaultCurrency, defaultLocale: previousInternationalCountry.defaultLocale, isActive: previousInternationalCountry.isActive } });
  if (createdBangladesh) await prisma.country.deleteMany({ where: { isoCode: "BD" } });
  else if (previousBangladesh) await prisma.country.update({ where: { isoCode: "BD" }, data: { isActive: previousBangladesh.isActive } });
  await prisma.$disconnect();
}
