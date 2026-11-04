import type { Prisma, PrismaClient, TicketStatus } from "@prisma/client";

type PolicyClient = Prisma.TransactionClient | PrismaClient;

export const ACTIVE_TICKET_STATUSES: TicketStatus[] = ["OPEN", "ASSIGNED", "WAITING_FOR_CUSTOMER", "WAITING_FOR_SUPPORT"];
export type SupportPolicyValue = { id: string; timeZone: string; firstResponseBusinessDays: number; approachingHours: number; businessWeekdays: number[]; openingMinute: number; closingMinute: number; requireScheduledShift: boolean; version: number };
export const DEFAULT_SUPPORT_POLICY: SupportPolicyValue = { id: "default", timeZone: "Asia/Dhaka", firstResponseBusinessDays: 5, approachingHours: 24, businessWeekdays: [1, 2, 3, 4, 5], openingMinute: 540, closingMinute: 1080, requireScheduledShift: false, version: 1 };

export async function getSupportOperatingPolicy(client: PolicyClient) {
  return await client.supportOperatingPolicy.findUnique({ where: { id: "default" } }) ?? DEFAULT_SUPPORT_POLICY;
}

function localDateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute") };
}

function utcForZonedTime(year: number, month: number, day: number, minuteOfDay: number, timeZone: string) {
  const target = Date.UTC(year, month - 1, day, Math.floor(minuteOfDay / 60), minuteOfDay % 60);
  let estimate = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = localDateParts(new Date(estimate), timeZone);
    const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    estimate -= represented - target;
  }
  return new Date(estimate);
}

function dateKey(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export async function calculateSupportSla(client: PolicyClient, start: Date) {
  const policy = await getSupportOperatingPolicy(client);
  const holidays = await client.supportHoliday.findMany({ select: { date: true }, take: 1000 });
  const holidayKeys = new Set(holidays.map((holiday) => holiday.date.toISOString().slice(0, 10)));
  const local = localDateParts(start, policy.timeZone);
  const cursor = new Date(Date.UTC(local.year, local.month - 1, local.day));
  let remaining = policy.firstResponseBusinessDays;
  for (let guard = 0; guard < 370; guard += 1) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const year = cursor.getUTCFullYear(); const month = cursor.getUTCMonth() + 1; const day = cursor.getUTCDate();
    if (!policy.businessWeekdays.includes(cursor.getUTCDay()) || holidayKeys.has(dateKey(year, month, day))) continue;
    remaining -= 1;
    if (remaining === 0) {
      const dueAt = utcForZonedTime(year, month, day, policy.closingMinute, policy.timeZone);
      return { dueAt, approachingAt: new Date(dueAt.getTime() - policy.approachingHours * 60 * 60 * 1000), policyVersion: policy.version };
    }
  }
  throw new Error("SUPPORT_CALENDAR_EXHAUSTED");
}

export function canTransitionTicket(from: TicketStatus, to: TicketStatus) {
  if (from === to) return true;
  const allowed: Record<TicketStatus, TicketStatus[]> = {
    OPEN: ["ASSIGNED", "WAITING_FOR_SUPPORT", "RESOLVED", "CLOSED"],
    ASSIGNED: ["WAITING_FOR_CUSTOMER", "WAITING_FOR_SUPPORT", "RESOLVED", "CLOSED"],
    WAITING_FOR_CUSTOMER: ["WAITING_FOR_SUPPORT", "RESOLVED", "CLOSED"],
    WAITING_FOR_SUPPORT: ["ASSIGNED", "WAITING_FOR_CUSTOMER", "RESOLVED", "CLOSED"],
    RESOLVED: ["WAITING_FOR_SUPPORT", "CLOSED"],
    CLOSED: [],
  };
  return allowed[from].includes(to);
}

export function ticketStatusLabel(status: TicketStatus) {
  return ({ OPEN: "Open", ASSIGNED: "Assigned", WAITING_FOR_CUSTOMER: "Waiting for customer", WAITING_FOR_SUPPORT: "Waiting for support", RESOLVED: "Resolved", CLOSED: "Closed" } as const)[status];
}

export function ticketSlaState(ticket: { slaDueAt: Date; slaApproachingAt?: Date | null; firstResponseAt: Date | null; resolvedAt: Date | null }, now = new Date()) {
  if (ticket.firstResponseAt || ticket.resolvedAt) return "RESPONDED" as const;
  if (ticket.slaDueAt <= now) return "BREACHED" as const;
  const approachingAt = ticket.slaApproachingAt ?? new Date(ticket.slaDueAt.getTime() - 24 * 60 * 60 * 1000);
  if (approachingAt <= now) return "APPROACHING" as const;
  return "ON_TRACK" as const;
}
