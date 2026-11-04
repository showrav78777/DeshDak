import { createHmac, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const origin = new URL(process.env.TEST_BASE_URL ?? process.env.APP_BASE_URL ?? "http://localhost:3000").origin;
const authSecret = process.env.AUTH_SECRET;
if (!authSecret) throw new Error("AUTH_SECRET is required for public rate-limit verification.");
const marker = randomBytes(4).toString("hex");
const clientIp = `198.51.100.${Number.parseInt(marker.slice(0, 2), 16) % 200 + 1}`;
const scope = "public-text-search";
const keyHash = createHmac("sha256", authSecret).update(`crossly:rate-limit:${scope}:${clientIp}`).digest("hex");

function assert(condition, message) { if (!condition) throw new Error(message); }

try {
  await prisma.securityRateLimit.deleteMany({ where: { scope, keyHash } });
  const requestCount = 20;
  const responses = await Promise.all(Array.from({ length: requestCount }, (_, index) => fetch(`${origin}/api/v1/search?q=security-${marker}-${index}`, { headers: { "x-forwarded-for": clientIp } })));
  assert(responses.every((response) => response.status === 200), `Public search requests failed: ${responses.map((response) => response.status).join(",")}`);
  const counter = await prisma.securityRateLimit.findUnique({ where: { scope_keyHash: { scope, keyHash } } });
  assert(counter?.attempts === requestCount, `Expected one durable atomic counter with ${requestCount} attempts, received ${counter?.attempts ?? "none"}.`);
  assert(responses.every((response) => response.headers.has("x-ratelimit-remaining")), "A search response omitted bounded-rate metadata.");
  console.log("Public rate-limit integration verification passed: concurrent requests share one atomic PostgreSQL counter.");
} finally {
  await prisma.securityRateLimit.deleteMany({ where: { scope, keyHash } });
  await prisma.$disconnect();
}
