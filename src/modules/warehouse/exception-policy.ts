import { prisma } from "@/lib/prisma";

export const WAREHOUSE_EXCEPTION_POLICY_KEY = "GLOBAL";

export function getWarehouseExceptionPolicy() {
  return prisma.warehouseExceptionPolicy.upsert({ where: { key: WAREHOUSE_EXCEPTION_POLICY_KEY }, update: {}, create: { key: WAREHOUSE_EXCEPTION_POLICY_KEY } });
}

export function ageHours(date: Date, now = new Date()) { return Math.max(0, Math.floor((now.getTime() - date.getTime()) / 3_600_000)); }
export function ageDays(date: Date, now = new Date()) { return Math.max(0, Math.floor((now.getTime() - date.getTime()) / 86_400_000)); }
