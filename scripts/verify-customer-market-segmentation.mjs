import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const baseUrl = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const unique = Date.now().toString();
const email = `market-segment-${unique}@example.test`;
const phone = `+1555${unique.slice(-7)}`;
let previousUsCountry = null;
let createdUsCountry = false;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function register(payload) {
  return fetch(new URL("/api/v1/auth/register", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

try {
  previousUsCountry = await prisma.country.findUnique({ where: { isoCode: "US" } });
  if (previousUsCountry) await prisma.country.update({ where: { isoCode: "US" }, data: { isActive: true } });
  else {
    await prisma.country.create({ data: { isoCode: "US", name: "United States", defaultCurrency: "USD", defaultLocale: "en", isActive: true } });
    createdUsCountry = true;
  }
  const incomplete = await register({ fullName: "Market Validation", email: `missing-${email}`, password: "CustomerMarketTest!2026" });
  assert(incomplete.status === 422, `Registration without country and phone returned ${incomplete.status}, expected 422.`);

  const response = await register({ fullName: "International Customer", email, phone: phone.replace("+1", "+1 ("), residenceCountryCode: "us", password: "CustomerMarketTest!2026" });
  assert(response.status === 201, `International registration returned ${response.status}, expected 201.`);

  const user = await prisma.user.findUnique({ where: { email }, select: { phone: true, residenceCountryCode: true } });
  assert(user?.residenceCountryCode === "US", "Residence country was not normalized and stored.");
  assert(user?.phone === phone, "Phone was not normalized to E.164 format.");

  console.log("Customer market segmentation verification passed.");
} finally {
  await prisma.user.deleteMany({ where: { email: { in: [email, `missing-${email}`] } } });
  if (createdUsCountry) await prisma.country.deleteMany({ where: { isoCode: "US" } });
  else if (previousUsCountry) await prisma.country.update({ where: { isoCode: "US" }, data: { name: previousUsCountry.name, defaultCurrency: previousUsCountry.defaultCurrency, defaultLocale: previousUsCountry.defaultLocale, isActive: previousUsCountry.isActive } });
  await prisma.$disconnect();
}
