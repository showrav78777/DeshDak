import "server-only";

import { authorizeComplianceCatalogAdmin } from "@/modules/compliance/catalog-authorization";
import { prisma } from "@/lib/prisma";
import { rescreenPublicCatalog } from "@/modules/compliance/restricted-goods";

export const COMPLIANCE_CATALOG_JOB_KEY = "compliance_catalog_rescreen";

export class ComplianceCatalogAccessError extends Error {
  constructor() { super("COMPLIANCE_CATALOG_ACCESS_CHANGED"); }
}
type MaintenanceInput = { triggerSource: "ADMIN"; triggeredById: string; sessionId: string } | { triggerSource: "SCHEDULER" | "TEST"; triggeredById?: null };

export async function runComplianceCatalogMaintenance(input: MaintenanceInput) {
  const claim = await prisma.$transaction(async tx => {
    if (input.triggerSource === "ADMIN" && !await authorizeComplianceCatalogAdmin(tx, input.triggeredById, input.sessionId)) return { outcome: "DENIED" } as const;
    await tx.maintenanceJobState.upsert({ where: { jobKey: COMPLIANCE_CATALOG_JOB_KEY }, update: {}, create: { jobKey: COMPLIANCE_CATALOG_JOB_KEY } });
    await tx.$queryRaw`SELECT "jobKey" FROM "MaintenanceJobState" WHERE "jobKey" = ${COMPLIANCE_CATALOG_JOB_KEY} FOR UPDATE`;
    // Acquiring the job row can wait; authorization must still be current afterward.
    if (input.triggerSource === "ADMIN" && !await authorizeComplianceCatalogAdmin(tx, input.triggeredById, input.sessionId)) return { outcome: "DENIED" } as const;
    const now = new Date();
    const claimed = await tx.maintenanceJobState.updateMany({
      where: { jobKey: COMPLIANCE_CATALOG_JOB_KEY, OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] },
      data: { lockedUntil: new Date(now.getTime() + 10 * 60_000), lastStartedAt: now, lastStatus: "RUNNING", lastErrorCode: null },
    });
    const run = await tx.maintenanceJobRun.create({ data: { jobKey: COMPLIANCE_CATALOG_JOB_KEY, triggerSource: input.triggerSource, triggeredById: input.triggeredById ?? null, status: claimed.count ? "RUNNING" : "SKIPPED", startedAt: now, ...(!claimed.count ? { finishedAt: now, summary: { reason: "already_running" } } : {}) } });
    return { outcome: "CLAIMED", run, skipped: !claimed.count } as const;
  });
  if (claim.outcome === "DENIED") throw new ComplianceCatalogAccessError();
  const { run } = claim;
  if (claim.skipped) return { run, skipped: true };
  try {
    const summary = await prisma.$transaction(async (tx) => {
      if (input.triggerSource === "ADMIN" && !await authorizeComplianceCatalogAdmin(tx, input.triggeredById, input.sessionId)) return null;
      const now = new Date();
      const [dueRules, expiredRules, missedScheduledRules] = await Promise.all([
        tx.restrictedGoodsRule.findMany({ where: { status: "SCHEDULED", effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] }, select: { id: true, ruleCode: true } }),
        tx.restrictedGoodsRule.findMany({ where: { status: "ACTIVE", effectiveTo: { lte: now } }, select: { id: true, ruleCode: true } }),
        tx.restrictedGoodsRule.findMany({ where: { status: "SCHEDULED", effectiveTo: { lte: now } }, select: { id: true, ruleCode: true } }),
      ]);
      if (dueRules.length) {
        await tx.restrictedGoodsRule.updateMany({ where: { id: { in: dueRules.map((rule) => rule.id) }, status: "SCHEDULED" }, data: { status: "ACTIVE", version: { increment: 1 } } });
      }
      const rulesToPause = [...expiredRules, ...missedScheduledRules];
      if (rulesToPause.length) {
        await tx.restrictedGoodsRule.updateMany({ where: { id: { in: rulesToPause.map((rule) => rule.id) }, status: { in: ["ACTIVE", "SCHEDULED"] } }, data: { status: "PAUSED", version: { increment: 1 } } });
      }
      const catalogRescreened = input.triggerSource !== "SCHEDULER" || dueRules.length > 0 || rulesToPause.length > 0;
      const publicCatalog = catalogRescreened ? await rescreenPublicCatalog(tx) : { clear: 0, blocked: 0, reviewRequired: 0 };
      const result = { scheduledRulesActivated: dueRules.length, scheduledRuleCodes: dueRules.map((rule) => rule.ruleCode), expiredRulesPaused: rulesToPause.length, expiredRuleCodes: rulesToPause.map((rule) => rule.ruleCode), catalogRescreened, publicCatalog };
      const finishedAt = new Date();
      await tx.maintenanceJobRun.update({ where: { id: run.id }, data: { status: "SUCCEEDED", finishedAt, summary: result } });
      await tx.maintenanceJobState.update({ where: { jobKey: COMPLIANCE_CATALOG_JOB_KEY }, data: { lockedUntil: null, lastFinishedAt: finishedAt, lastStatus: "SUCCEEDED", lastSummary: result, lastErrorCode: null } });
      await tx.auditLog.create({ data: { actorId: input.triggeredById ?? null, action: "compliance.catalog_rescreen_completed", entityType: "MaintenanceJobRun", entityId: run.id, metadata: { triggerSource: input.triggerSource, ...result } } });
      return result;
    }, { maxWait: 5_000, timeout: 30_000 });
    if (!summary) throw new ComplianceCatalogAccessError();
    return { run: { ...run, status: "SUCCEEDED" as const, finishedAt: new Date(), summary }, skipped: false };
  } catch (error) {
    const errorCode = error instanceof ComplianceCatalogAccessError ? error.message : "COMPLIANCE_CATALOG_RESCREEN_FAILED";
    const failedAt = new Date();
    await prisma.$transaction([
      prisma.maintenanceJobRun.update({ where: { id: run.id }, data: { status: "FAILED", finishedAt: failedAt, errorCode } }),
      prisma.maintenanceJobState.update({ where: { jobKey: COMPLIANCE_CATALOG_JOB_KEY }, data: { lockedUntil: null, lastFinishedAt: failedAt, lastStatus: "FAILED", lastErrorCode: errorCode } }),
    ]);
    if (error instanceof ComplianceCatalogAccessError) throw error;
    throw new Error("COMPLIANCE_CATALOG_RESCREEN_FAILED");
  }
}
