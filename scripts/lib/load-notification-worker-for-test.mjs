import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";

export function sourceModule(source) { return `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source.replace('import "server-only";', ""))).toString("base64")}`; }

/** Test-only loader: real PostgreSQL, synthetic transport and one synthetic user. */
export async function loadNotificationWorker(prisma, userId) {
  const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/invalid");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !/^crossly_launch_verify_[a-f0-9]{16}$/.test(url.searchParams.get("schema") ?? "")) throw new Error("Worker loader requires a disposable local schema.");
  const binding = `__deshdakDeliveryTest_${randomBytes(8).toString("hex")}`;
  globalThis[binding] = {
    notificationDelivery: {
      findMany: args => prisma.notificationDelivery.findMany({ ...args, where: { AND: [args.where, { notification: { userId } }] } }),
      updateMany: args => prisma.notificationDelivery.updateMany(args),
    },
    $transaction: prisma.$transaction.bind(prisma),
  };
  try {
    const securityUrl = sourceModule(await readFile(new URL("../../src/lib/security-secrets.ts", import.meta.url), "utf8"));
    const eventUrl = sourceModule(await readFile(new URL("../../src/modules/notifications/email-events.ts", import.meta.url), "utf8"));
    const source = (await readFile(new URL("../../src/modules/notifications/delivery.ts", import.meta.url), "utf8"))
      .replace('import { type NotificationDelivery, type Prisma } from "@prisma/client";', "")
      .replace('from "@/lib/security-secrets"', `from "${securityUrl}"`)
      .replace('from "@/modules/notifications/email-events"', `from "${eventUrl}"`)
      .replace('import { prisma } from "@/lib/prisma";', `const prisma = globalThis[${JSON.stringify(binding)}];`);
    return { ...await import(sourceModule(source)), security: await import(securityUrl) };
  } finally { delete globalThis[binding]; }
}
