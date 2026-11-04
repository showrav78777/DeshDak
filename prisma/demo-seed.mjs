import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { seedOperationalDemo } from "./demo-operational-seed.mjs";

const prisma = new PrismaClient();
const DEMO_DOMAIN = "example.test";
const DEMO_PASSWORD = process.env.DEMO_ACCOUNT_PASSWORD?.trim() || "CrosslyDemo!2026";
const isProduction = process.env.NODE_ENV === "production" || process.env.APP_ENV === "production";
const mode = process.argv.includes("--clear") ? "clear" : process.argv.includes("--reset") ? "reset" : "seed";
const entityCode = (prefix, value) => `${prefix}-${createHash("sha256").update(`crossly-demo:${value}`).digest("hex").slice(0, 20).toUpperCase()}`;

if (isProduction) throw new Error("Demo data is blocked in production.");
if (process.env.DEMO_DATA_ENABLED !== "true") throw new Error("Set DEMO_DATA_ENABLED=true in a non-production environment before managing demo data.");

const roleDefinitions = [
  ["customer_personal", "Personal customer"], ["seller", "Bangladesh local seller"],
  ["admin", "Platform administrator"], ["sourcing_agent", "Sourcing operations agent"],
  ["kam", "Sales and account manager"],
  ["warehouse_worker", "Warehouse operations worker"], ["inspector", "Warehouse quality inspector"],
  ["logistics_worker", "Logistics operations worker"], ["customer_service", "Customer service agent"],
  ["compliance", "Compliance review officer"], ["finance", "Finance operations officer"],
];

const customerProfiles = Array.from({ length: 30 }, (_, index) => ({
  key: `customer${String(index + 1).padStart(2, "0")}`,
  name: ["New Customer", "Active Shopper", "Buy and Ship Customer", "Ship for Me Customer", "Sea Shipping Customer", "VIP Customer", "Failed Payment Customer", "Support Case Customer", "Refund Customer", "Multi Address Customer"][index] ?? `Marketplace Customer ${index + 1}`,
  role: "customer_personal",
  residenceCountryCode: index % 5 === 0 ? "US" : "BD",
}));

const staffProfiles = [
  ["admin", "Demo Administrator", "admin"], ["support01", "Customer Service Agent 01", "customer_service"],
  ["support02", "Customer Service Agent 02", "customer_service"], ["support03", "Customer Service Supervisor", "customer_service"], ["warehouse01", "Warehouse Receiver", "warehouse_worker"],
  ["warehouse02", "Warehouse Scanner", "warehouse_worker"], ["inspector01", "Warehouse Inspector", "inspector"],
  ["inspector02", "Warehouse Quality Inspector", "inspector"], ["logistics01", "Air Shipping Coordinator", "logistics_worker"], ["logistics02", "Sea Shipping Coordinator", "logistics_worker"], ["sourcing01", "Sourcing Executive", "sourcing_agent"],
  ["finance01", "Finance Executive", "finance"], ["finance02", "Payment Verification Officer", "finance"], ["compliance01", "Compliance Officer", "compliance"],
  ["sales01", "Sales and Account Manager", "kam"],
].map(([key, name, role]) => ({ key, name, role, residenceCountryCode: "BD" }));

const sellerProfiles = [
  { key: "seller01", name: "Riverloom Seller", businessName: "Riverloom Bangladesh", slug: "riverloom-bangladesh" },
  { key: "seller02", name: "Bengal Craft Seller", businessName: "Bengal Craft House", slug: "bengal-craft-house" },
  { key: "seller03", name: "Dhaka Digital Seller", businessName: "Dhaka Digital Mart", slug: "dhaka-digital-mart" },
  { key: "seller04", name: "Nokshi Home Seller", businessName: "Nokshi Home Store", slug: "nokshi-home-store" },
];

const productNouns = ["Wireless Earbuds", "Smart Desk Lamp", "Travel Organizer", "Cotton Tote Bag", "Bamboo Serving Tray", "Learning Blocks", "Phone Stand", "Fitness Bottle", "Skin Care Organizer", "Portable Fan", "Canvas Backpack", "Kitchen Tool Set", "Baby Feeding Set", "Car Storage Pocket", "Office Notebook", "Sports Towel"];
const productAdjectives = ["Everyday", "Premium", "Compact", "Modern"];

async function clearDemoCatalog() {
  await prisma.reel.deleteMany({ where: { product: { is: { titleEn: { startsWith: "[Demo]" } } } } });
  await prisma.product.deleteMany({ where: { titleEn: { startsWith: "[Demo]" } } });
  await prisma.sellerProfile.deleteMany({ where: { user: { is: { email: { endsWith: `@${DEMO_DOMAIN}` } } } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${DEMO_DOMAIN}` } } });
}

async function ensureUser(profile, passwordHash) {
  const email = `${profile.key}@${DEMO_DOMAIN}`;
  const user = await prisma.user.upsert({
    where: { email },
    update: { fullName: profile.name, passwordHash, status: "ACTIVE", residenceCountryCode: profile.residenceCountryCode },
    create: {
      personCode: entityCode("PER", profile.key),
      email, passwordHash, fullName: profile.name, status: "ACTIVE",
      residenceCountryCode: profile.residenceCountryCode, locale: "en", analyticsConsent: true,
    },
  });
  const role = await prisma.role.findUniqueOrThrow({ where: { code: profile.role } });
  await prisma.userRole.upsert({ where: { userId_roleId: { userId: user.id, roleId: role.id } }, update: {}, create: { userId: user.id, roleId: role.id } });
  return user;
}

async function seed() {
  for (const [code, description] of roleDefinitions) await prisma.role.upsert({ where: { code }, update: { description }, create: { code, description } });
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const users = {};
  for (const profile of [...customerProfiles, ...staffProfiles]) users[profile.key] = await ensureUser(profile, passwordHash);

  // Demonstrate the order-verification states without using real identities or phone numbers.
  // customer01 is intentionally unverified, customer08 awaits Compliance review, and the rest
  // are ready to exercise checkout and operational workflows.
  const demoNow = new Date();
  for (const [index, profile] of customerProfiles.entries()) {
    const user = users[profile.key];
    const pending = profile.key === "customer08";
    const verified = profile.key !== "customer01" && !pending;
    await prisma.user.update({ where: { id: user.id }, data: { phone: `+88017000${String(index + 1).padStart(4, "0")}`, phoneVerifiedAt: verified ? demoNow : null, kycStatus: verified ? "VERIFIED" : pending ? "PENDING" : "NOT_REQUIRED" } });
    if (verified) {
      const existing = await prisma.identityVerification.findFirst({ where: { userId: user.id, status: "VERIFIED" }, select: { id: true } });
      if (!existing) await prisma.identityVerification.create({ data: { userId: user.id, documentType: index % 3 === 0 ? "NATIONAL_ID" : index % 3 === 1 ? "PASSPORT" : "DRIVING_LICENSE", issuingCountryCode: profile.residenceCountryCode, documentNumberLast4: String(1000 + index), status: "VERIFIED", reviewedAt: demoNow, reviewedById: users.compliance01.id, reviewNote: "Fictional demo identity verification approved for checkout testing." } });
    }
    if (pending) {
      const existing = await prisma.identityVerification.findFirst({ where: { userId: user.id, status: "PENDING" }, select: { id: true } });
      if (!existing) await prisma.identityVerification.create({ data: { userId: user.id, documentType: "PASSPORT", issuingCountryCode: profile.residenceCountryCode, documentNumberLast4: "DEMO", status: "PENDING" } });
    }
  }

  const sellers = [];
  for (const profile of sellerProfiles) {
    const user = await ensureUser({ ...profile, role: "seller", residenceCountryCode: "BD" }, passwordHash);
    users[profile.key] = user;
    sellers.push(await prisma.sellerProfile.upsert({
      where: { userId: user.id },
      update: { businessName: profile.businessName, storeSlug: profile.slug, status: "APPROVED", shipsInternationally: true },
      create: { storeCode: entityCode("STR", profile.key), userId: user.id, businessName: profile.businessName, storeSlug: profile.slug, storeDescription: "Fictional demo store for testing DUAR marketplace workflows.", originCountryCode: "BD", status: "APPROVED", shipsInternationally: true },
    }));
  }

  const categories = await prisma.category.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } });
  if (!categories.length) throw new Error("Run npm run db:seed first so active categories exist.");
  const commentAuthors = await prisma.user.findMany({ where: { email: { in: [`customer02@${DEMO_DOMAIN}`, `customer06@${DEMO_DOMAIN}`] } }, orderBy: { email: "asc" } });

  const products = [];
  for (let index = 0; index < 96; index += 1) {
    const number = String(index + 1).padStart(3, "0");
    const category = categories[index % categories.length];
    const local = index < 20;
    const titleEn = `[Demo] ${productAdjectives[Math.floor(index / productNouns.length) % productAdjectives.length]} ${productNouns[index % productNouns.length]}`;
    const product = await prisma.product.upsert({
      where: { productCode: entityCode("PRD", `product-${number}`) },
      update: { titleEn },
      create: {
        productCode: entityCode("PRD", `product-${number}`),
        titleEn,
        shortDescription: "A fictional marketplace listing created for safe interface and workflow testing.",
        description: "Demo product information includes pricing, stock, packaging, discovery, cart, and cross-border availability fields. It does not represent a real product or supplier.",
        highlights: ["Demo listing", index % 3 === 0 ? "Multiple options" : "Ready to order", local ? "Bangladesh origin" : "Global sourcing catalog"],
        status: "ACTIVE", complianceStatus: "CLEAR", categoryId: category.id,
        sellerProfileId: local ? sellers[index % sellers.length].id : null,
        originCountryCode: local ? "BD" : "CN", isInternationallyAvailable: true,
        minimumOrderQuantity: index % 7 === 0 ? 10 : 1, sellingUnit: "piece",
        sampleAvailable: index % 4 === 0, customizationAvailable: index % 5 === 0,
        productionLeadDaysMin: 2, productionLeadDaysMax: 7, completenessScore: 96,
        packageContents: "One demo product and protective packaging.", returnPolicy: "Demo return policy for workflow testing only.",
        variants: { create: [0, ...(index % 4 === 0 ? [1, 2] : [])].map((variantIndex) => ({
          sku: `DEMO-SKU-${number}-${variantIndex + 1}`,
          attributes: { color: ["Blue", "Black", "Natural"][variantIndex], size: variantIndex ? "Large" : "Standard" },
          priceBdt: String(450 + index * 55 + variantIndex * 80), inventoryQuantity: index % 13 === 0 ? 0 : 20 + index,
          stockStatus: index % 13 === 0 ? "OUT_OF_STOCK" : index % 11 === 0 ? "LOW_STOCK" : "IN_STOCK",
          weightGrams: 250 + index * 35, lengthMm: 180, widthMm: 120, heightMm: 80,
        })) },
        media: { create: { kind: "IMAGE", status: "READY", storageKey: `demo/products/${number}/primary.webp`, originalFilename: `demo-product-${number}.webp`, mimeType: "image/webp", sizeBytes: 24000, checksumSha256: `${number.padStart(64, "0")}`.slice(-64), altText: `Fictional demo product ${number}`, isPrimary: true } },
      },
      include: { media: true },
    });
    products.push(product);
  }

  for (let index = 0; index < 30; index += 1) {
    const product = products[index];
    const number = String(index + 1).padStart(3, "0");
    const video = await prisma.productMedia.upsert({
      where: { storageKey: `demo/reels/${number}.mp4` },
      update: {},
      create: { productId: product.id, kind: "VIDEO", status: "READY", storageKey: `demo/reels/${number}.mp4`, originalFilename: `demo-reel-${number}.mp4`, mimeType: "video/mp4", sizeBytes: 480000, checksumSha256: `${(index + 101).toString().padStart(64, "0")}`.slice(-64), altText: `Demo Reel for ${product.titleEn}`, caption: "Fictional video reference; connect approved media storage to play.", sortOrder: 10 },
    });
    const reel = await prisma.reel.upsert({
      where: { reelCode: entityCode("REL", `reel-${number}`) }, update: {},
      create: { reelCode: entityCode("REL", `reel-${number}`), sellerProfileId: product.sellerProfileId ?? sellers[index % sellers.length].id, productId: product.id, mediaId: video.id, caption: `See ${product.titleEn} in this fictional commerce demo.`, status: "ACTIVE", publishedAt: new Date(Date.now() - index * 86_400_000), viewCount: 120 + index * 617, likeCount: 10 + index * 43, commentCount: 1, shareCount: index * 3, saveCount: index * 5 },
    });
    await prisma.reelComment.upsert({ where: { id: `demo-comment-${number}` }, update: {}, create: { id: `demo-comment-${number}`, reelId: reel.id, authorId: commentAuthors[index % commentAuthors.length].id, body: index % 2 ? "Can this be shipped by air? This is a fictional test comment." : "The product details are clear. This is a fictional test comment.", status: "PUBLISHED", publishedAt: new Date(Date.now() - index * 43_200_000) } });
    if (index % 5 === 0) await prisma.reelComment.upsert({ where: { id: `demo-moderated-comment-${number}` }, update: {}, create: { id: `demo-moderated-comment-${number}`, reelId: reel.id, authorId: commentAuthors[(index + 1) % commentAuthors.length].id, body: "Fictional comment retained to test moderation.", status: "REJECTED", reviewNote: "Demo moderation decision." } });
  }

  await seedOperationalDemo({ prisma, users, products });

  console.log(`Demo seed complete: ${customerProfiles.length} customers, ${staffProfiles.length} staff, ${sellerProfiles.length} sellers, ${products.length} products, 30 Reels, payment setup, currencies, routes, orders, parcels, shipments, support, promotions, advertisements, and wallet activity.`);
  console.log(`Demo accounts use *@${DEMO_DOMAIN}. Password comes from DEMO_ACCOUNT_PASSWORD${process.env.DEMO_ACCOUNT_PASSWORD ? "." : " (development default applied)."}`);
}

try {
  if (mode === "clear" || mode === "reset") await clearDemoCatalog();
  if (mode !== "clear") await seed();
  if (mode === "clear") console.log("Seeded demo catalog and accounts cleared.");
} finally {
  await prisma.$disconnect();
}
