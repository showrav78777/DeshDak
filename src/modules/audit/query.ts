import type { Prisma, PrismaClient } from "@prisma/client";

const SENSITIVE_KEY = /(authorization|cookie|credential|password|secret|token|otp|recovery|private.?key|card|cvv|pin)/i;

export type AuditQueryInput = {
  q: string;
  action: string;
  entityType: string;
  from: string;
  to: string;
  page: number;
  pageSize: number;
};

export function parseAuditQuery(params: URLSearchParams): AuditQueryInput {
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(10, Number.parseInt(params.get("pageSize") ?? "25", 10) || 25));
  return {
    q: (params.get("q") ?? "").trim().slice(0, 120),
    action: (params.get("action") ?? "").trim().slice(0, 100),
    entityType: (params.get("entityType") ?? "").trim().slice(0, 80),
    from: validDate(params.get("from")),
    to: validDate(params.get("to")),
    page,
    pageSize,
  };
}

function validDate(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  return Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)) ? "" : value;
}

function scrub(value: unknown, depth = 0): unknown {
  if (depth > 3) return "[TRUNCATED]";
  if (typeof value === "string") return value.length > 300 ? `${value.slice(0, 300)}…` : value;
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => scrub(item, depth + 1));
  if (typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 40).map(([key, item]) => [key, SENSITIVE_KEY.test(key) ? "[REDACTED]" : scrub(item, depth + 1)]));
  return String(value);
}

export function safeAuditMetadata(metadata: Prisma.JsonValue | null): unknown {
  return metadata === null ? null : scrub(metadata);
}

export async function queryAuditEvents(client: PrismaClient, input: AuditQueryInput) {
  const createdAt: Prisma.DateTimeFilter = {};
  if (input.from) createdAt.gte = new Date(`${input.from}T00:00:00.000Z`);
  if (input.to) createdAt.lt = new Date(new Date(`${input.to}T00:00:00.000Z`).getTime() + 86_400_000);
  const where: Prisma.AuditLogWhereInput = {
    ...(input.action ? { action: { contains: input.action, mode: "insensitive" } } : {}),
    ...(input.entityType ? { entityType: { equals: input.entityType, mode: "insensitive" } } : {}),
    ...(Object.keys(createdAt).length ? { createdAt } : {}),
    ...(input.q ? { OR: [
      { action: { contains: input.q, mode: "insensitive" } },
      { entityType: { contains: input.q, mode: "insensitive" } },
      { entityId: { contains: input.q, mode: "insensitive" } },
      { actor: { is: { OR: [{ fullName: { contains: input.q, mode: "insensitive" } }, { email: { contains: input.q, mode: "insensitive" } }, { personCode: { contains: input.q, mode: "insensitive" } }] } } },
    ] } : {}),
  };
  const [events, total, entityTypes] = await client.$transaction([
    client.auditLog.findMany({ where, select: { id: true, action: true, entityType: true, entityId: true, metadata: true, createdAt: true, actor: { select: { id: true, personCode: true, fullName: true, email: true } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (input.page - 1) * input.pageSize, take: input.pageSize }),
    client.auditLog.count({ where }),
    client.auditLog.findMany({ distinct: ["entityType"], select: { entityType: true }, orderBy: { entityType: "asc" }, take: 200 }),
  ]);
  return {
    events: events.map((event) => ({ ...event, metadata: safeAuditMetadata(event.metadata) })),
    entityTypes: entityTypes.map((item) => item.entityType),
    pagination: { page: input.page, pageSize: input.pageSize, total, pages: Math.max(1, Math.ceil(total / input.pageSize)) },
  };
}
