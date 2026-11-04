import { Prisma } from "@prisma/client";

export async function releaseExpiredInventoryReservations(tx: Prisma.TransactionClient, now = new Date(), batchSize = 100) {
  const expired = await tx.inventoryReservation.findMany({ where: { status: "ACTIVE", expiresAt: { lte: now } }, select: { id: true, orderId: true, productVariantId: true, quantity: true }, orderBy: { expiresAt: "asc" }, take: Math.min(Math.max(batchSize, 1), 500) });
  let released = 0;
  for (const reservation of expired) {
    const claimed = await tx.inventoryReservation.updateMany({ where: { id: reservation.id, status: "ACTIVE", expiresAt: { lte: now } }, data: { status: "EXPIRED" } });
    if (claimed.count !== 1) continue;
    await tx.productVariant.update({ where: { id: reservation.productVariantId }, data: { inventoryQuantity: { increment: reservation.quantity } } });
    await tx.auditLog.create({ data: { action: "inventory.reservation_expired", entityType: "InventoryReservation", entityId: reservation.id, metadata: { orderId: reservation.orderId, productVariantId: reservation.productVariantId, quantity: reservation.quantity } } });
    released += 1;
  }
  return released;
}
