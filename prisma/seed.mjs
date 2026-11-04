import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const roles = [
  ["customer_personal", "Personal customer"],
  ["seller", "Bangladesh local seller"],
  ["admin", "Platform administrator"],
  ["sourcing_agent", "Sourcing operations agent"],
  ["kam", "Sales and account manager"],
  ["warehouse_worker", "Warehouse operations worker"],
  ["inspector", "Warehouse quality inspector"],
  ["logistics_worker", "Logistics operations worker"],
  ["customer_service", "Customer service agent"],
  ["compliance", "Compliance review officer"],
  ["finance", "Finance operations officer"],
];
const categories = [
  { slug: "phones-gadgets", nameEn: "Phones & gadgets", description: "Smartphones, accessories, and wearables", icon: "📱", sortOrder: 10 },
  { slug: "computers", nameEn: "Computers", description: "Laptops, tablets, and peripherals", icon: "💻", sortOrder: 20 },
  { slug: "fashion", nameEn: "Fashion", description: "Clothing, shoes, and bags", icon: "👗", sortOrder: 30 },
  { slug: "home-living", nameEn: "Home & living", description: "Kitchen, décor, and appliances", icon: "🏠", sortOrder: 40 },
  { slug: "beauty-care", nameEn: "Beauty & care", description: "Skin care and beauty tools", icon: "💄", sortOrder: 50 },
  { slug: "kids-toys", nameEn: "Kids & toys", description: "Toys, baby, and school items", icon: "🧸", sortOrder: 60 },
  { slug: "auto-tools", nameEn: "Auto & tools", description: "Vehicle accessories and equipment", icon: "🚗", sortOrder: 70 },
  { slug: "sports-outdoor", nameEn: "Sports & outdoor", description: "Fitness, travel, and recreation", icon: "🏋️", sortOrder: 80 },
];
const sourcePlatforms = [
  { code: "SOURCE_1688", displayName: "1688", adapterKey: "SOURCE_1688_ADAPTER", supportedCountries: ["CN"] },
  { code: "PINDUODUO", displayName: "Pinduoduo", adapterKey: "PINDUODUO_ADAPTER", supportedCountries: ["CN"] },
  { code: "ALIBABA", displayName: "Alibaba", adapterKey: "ALIBABA_ADAPTER", supportedCountries: ["CN"] },
];

try {
  for (const [code, description] of roles) await prisma.role.upsert({ where: { code }, update: { description }, create: { code, description } });
  for (const category of categories) await prisma.category.upsert({ where: { slug: category.slug }, update: {}, create: { ...category, isActive: true, showOnHomepage: true } });
  for (const platform of sourcePlatforms) await prisma.sourcePlatform.upsert({ where: { code: platform.code }, update: {}, create: { ...platform, isActive: false } });
  console.log(`Bootstrap complete: ${roles.length} roles, ${categories.length} categories, and ${sourcePlatforms.length} inactive source records ensured.`);
} finally {
  await prisma.$disconnect();
}
