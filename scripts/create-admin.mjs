import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME = "Platform Administrator" } = process.env;
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD before running this command.");
if (ADMIN_PASSWORD.length < 12) throw new Error("ADMIN_PASSWORD must contain at least 12 characters.");

const prisma = new PrismaClient();
const role = await prisma.role.upsert({ where: { code: "admin" }, update: {}, create: { code: "admin", description: "Platform administrator" } });
const user = await prisma.user.upsert({
  where: { email: ADMIN_EMAIL.toLowerCase() },
  update: { fullName: ADMIN_NAME, passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 12), status: "ACTIVE" },
  create: { email: ADMIN_EMAIL.toLowerCase(), fullName: ADMIN_NAME, passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 12), status: "ACTIVE" },
});
await prisma.userRole.upsert({ where: { userId_roleId: { userId: user.id, roleId: role.id } }, update: {}, create: { userId: user.id, roleId: role.id } });
console.log(`Admin ready: ${user.email}`);
await prisma.$disconnect();
