import { PrismaClient } from "@prisma/client";

// Read-only deployment preflight. Never print tracking values, customer data,
// database URLs or raw database errors into CI logs.
const prisma = new PrismaClient();
try {
  const [summary] = await prisma.$queryRaw`
    SELECT COUNT(*)::integer AS "conflictGroups",
           COALESCE(SUM("packageCount"), 0)::integer AS "affectedPackages"
    FROM (
      SELECT COUNT(*) AS "packageCount"
      FROM "Package"
      WHERE "inboundTracking" IS NOT NULL
      GROUP BY lower("inboundTracking")
      HAVING COUNT(*) > 1
    ) AS conflicts
  `;
  if (summary.conflictGroups > 0) {
    console.error(`Inbound tracking preflight blocked: ${summary.conflictGroups} case-insensitive conflict group(s), ${summary.affectedPackages} affected packages. Authorized operations must review original evidence before migration. No data was changed.`);
    process.exitCode = 1;
  } else {
    console.log("Inbound tracking preflight passed: no case-insensitive duplicates. Read-only check; no data changed. This does not prove the uniqueness migration is installed.");
  }
} catch {
  console.error("Inbound tracking preflight failed. Check database access and schema with an authorized operator. No remediation was attempted.");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
