import { type Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { type WarehouseAccess, warehouseIdFilter } from "@/lib/warehouse-access";

const packageCodePattern = /^PKG-[A-F0-9]{12}$/;
const orderCodePattern = /^ORD-[A-F0-9]{12,32}$/;

export function normalizeWarehouseScan(raw: string) {
  const input = raw.trim().slice(0, 500);
  if (!input) return null;
  let candidate = input;
  try {
    const url = new URL(input);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    candidate = decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) ?? "");
  } catch {
    candidate = input;
  }
  const normalized = candidate.trim().toUpperCase();
  if (packageCodePattern.test(normalized) || orderCodePattern.test(normalized)) return normalized;
  return candidate.trim().length >= 4 && candidate.trim().length <= 120 ? candidate.trim() : null;
}

export async function resolveWarehouseScan(code: string, access: WarehouseAccess) {
  const warehouseId = warehouseIdFilter(access);
  const packageWhere: Prisma.PackageWhereInput = {
    ...(warehouseId ? { warehouseId } : {}),
    isOutboundActive: true,
    OR: [
      { packageCode: { equals: code, mode: "insensitive" } },
      { inboundTracking: { equals: code, mode: "insensitive" } },
      { order: { orderNumber: { equals: code, mode: "insensitive" } } },
    ],
  };
  const pkg = await prisma.package.findFirst({ where: packageWhere, select: { id: true, packageCode: true, status: true, warehouseId: true, order: { select: { orderNumber: true } } } });
  if (pkg) return { kind: "package" as const, package: pkg, destination: `/warehouse/packages/${encodeURIComponent(pkg.packageCode)}` };

  const order = await prisma.order.findFirst({
    where: { orderNumber: { equals: code, mode: "insensitive" }, status: { in: ["SUPPLIER_SHIPPED", "READY_FOR_COLLECTION"] } },
    select: { id: true, orderNumber: true, status: true, originCountryCode: true, sourcingRequest: { select: { productTitle: true, quantity: true, selectedVariant: true } }, items: { select: { productTitle: true, quantity: true }, take: 1 } },
  });
  if (!order) return null;
  const matchingWarehouses = await prisma.warehouse.findMany({
    where: { type: "ORIGIN", ...(order.originCountryCode ? { country: order.originCountryCode } : {}), ...(warehouseId ? { id: warehouseId } : {}) },
    select: { id: true, name: true, country: true },
    orderBy: { name: "asc" },
  });
  if (!matchingWarehouses.length) return null;
  return { kind: "order" as const, order, matchingWarehouses, destination: `/warehouse/scan/${encodeURIComponent(order.orderNumber)}` };
}
