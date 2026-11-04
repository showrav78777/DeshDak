import type { Prisma } from "@prisma/client";

// Grant and revoke must share a transaction lock before reading the assignment.
export async function lockSourcingStaffAccess(tx: Prisma.TransactionClient, userId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crossly:sourcing-staff:${userId}`}, 0))`;
}
