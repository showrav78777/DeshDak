import { createHash } from "node:crypto";
import { z } from "zod";

export const warehouseReceiptSchema = z.object({
  orderNumber: z.string().trim().min(4).max(80),
  warehouseId: z.string().uuid(),
  inboundTracking: z.string().trim().max(120).optional(),
  packageCode: z.string().trim().regex(/^PKG-[A-F0-9]{12}$/).optional(),
}).strict();

export function receiptRequestHash(actorId: string, input: z.infer<typeof warehouseReceiptSchema>) {
  return createHash("sha256").update(JSON.stringify({ actorId, orderNumber: input.orderNumber, warehouseId: input.warehouseId, inboundTracking: input.inboundTracking || null, packageCode: input.packageCode || null })).digest("hex");
}

export function matchesReceiptReplay(event: { actorId: string | null; metadata: unknown } | null, actorId: string, requestHash: string) {
  const metadata = event?.metadata;
  return event?.actorId === actorId && Boolean(metadata && typeof metadata === "object" && !Array.isArray(metadata) && "receiveRequestHash" in metadata && metadata.receiveRequestHash === requestHash);
}
