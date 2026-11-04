import type { Prisma } from "@prisma/client";

type DatabaseClient = Prisma.TransactionClient;

type ServerEventInput = {
  idempotencyKey?: string | null;
  userId?: string | null;
  authSessionId?: string | null;
  category: "SECURITY" | "COMMERCE" | "BEHAVIORAL" | "SUPPORT";
  eventType: string;
  objectType?: string | null;
  objectId?: string | null;
  source?: "SERVER" | "WEB" | "MOBILE";
  path?: string | null;
  metadata?: Prisma.InputJsonValue;
};

export function safeActivityPath(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  return value.split("?", 1)[0].slice(0, 240);
}

export function recordUserEvent(database: DatabaseClient, input: ServerEventInput) {
  return database.userEvent.create({
    data: {
      idempotencyKey: input.idempotencyKey?.slice(0, 160) ?? null,
      userId: input.userId ?? null,
      authSessionId: input.authSessionId ?? null,
      category: input.category,
      eventType: input.eventType.slice(0, 80),
      objectType: input.objectType?.slice(0, 80) ?? null,
      objectId: input.objectId?.slice(0, 160) ?? null,
      source: input.source ?? "SERVER",
      path: safeActivityPath(input.path),
      metadata: input.metadata,
    },
  });
}
