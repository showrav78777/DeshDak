import "server-only";
import { prisma } from "@/lib/prisma";
import { ROLE } from "@/lib/roles";
import { validateProductionEnvironment } from "../../../scripts/lib/production-config.mjs";

export type TechnicalReadinessSignal = {
  code: string;
  label: string;
  status: "PASS" | "FAIL" | "DEVELOPMENT";
  detail: string;
  checkedAt: string;
};

const operationalRoles = [ROLE.ADMIN, ROLE.SOURCING_AGENT, ROLE.WAREHOUSE_WORKER, ROLE.INSPECTOR, ROLE.LOGISTICS_WORKER, ROLE.CUSTOMER_SERVICE, ROLE.COMPLIANCE, ROLE.FINANCE];

export async function getTechnicalReadinessSignals(): Promise<TechnicalReadinessSignal[]> {
  const checkedAt = new Date().toISOString();
  const [databaseProbe, checkoutLanes, paymentMethods, warehouses, staffedRoles] = await Promise.all([
    prisma.$queryRaw<Array<{ value: number }>>`SELECT 1 AS value`,
    prisma.shippingLane.count({ where: { isActive: true, financeApproved: true, complianceApproved: true, operationsApproved: true, checkoutEnabled: true, originCountry: { isActive: true }, destinationCountry: { isActive: true } } }),
    prisma.countryPaymentMethod.count({ where: { financeApproved: true, complianceApproved: true, refundsApproved: true, reconciliationApproved: true, checkoutEnabled: true, country: { isActive: true }, paymentMethod: { isActive: true } } }),
    prisma.warehouse.count(),
    prisma.userRole.findMany({ where: { role: { code: { in: operationalRoles } }, user: { status: "ACTIVE", deletedAt: null } }, select: { role: { select: { code: true } } } }),
  ]);
  const productionConfig = validateProductionEnvironment(process.env) as { ok: boolean; errors: string[] };
  const staffed = new Set(staffedRoles.map(({ role }) => role.code));
  const missingRoleCount = operationalRoles.filter((role) => !staffed.has(role)).length;
  const development = process.env.NODE_ENV !== "production";
  const status = (ready: boolean): TechnicalReadinessSignal["status"] => development ? "DEVELOPMENT" : ready ? "PASS" : "FAIL";

  return [
    { code: "DATABASE", label: "Database connectivity", status: databaseProbe[0]?.value === 1 ? "PASS" : "FAIL", detail: databaseProbe[0]?.value === 1 ? "The application database answered the readiness probe." : "The database readiness probe failed.", checkedAt },
    { code: "PRODUCTION_CONFIG", label: "Production configuration", status: status(productionConfig.ok), detail: productionConfig.ok ? "All fail-closed production configuration rules pass." : `${productionConfig.errors.length} production configuration control${productionConfig.errors.length === 1 ? "" : "s"} still require secure deployment values.`, checkedAt },
    { code: "CHECKOUT_LANE", label: "Approved checkout lane", status: status(checkoutLanes > 0), detail: checkoutLanes > 0 ? `${checkoutLanes} fully approved checkout lane${checkoutLanes === 1 ? "" : "s"} configured.` : "No fully approved customer checkout lane is configured.", checkedAt },
    { code: "PAYMENT_METHOD", label: "Approved payment path", status: status(paymentMethods > 0), detail: paymentMethods > 0 ? `${paymentMethods} country payment path${paymentMethods === 1 ? "" : "s"} pass Finance, Compliance, refund, and reconciliation flags.` : "No active country payment path passes every readiness flag.", checkedAt },
    { code: "WAREHOUSE", label: "Warehouse configuration", status: status(warehouses > 0), detail: warehouses > 0 ? `${warehouses} warehouse record${warehouses === 1 ? "" : "s"} configured; physical acceptance remains external evidence.` : "No warehouse record is configured.", checkedAt },
    { code: "ROLE_STAFFING", label: "Operational role coverage", status: status(missingRoleCount === 0), detail: missingRoleCount === 0 ? "Every required operational role has an active account." : `${missingRoleCount} required operational role${missingRoleCount === 1 ? "" : "s"} have no active account.`, checkedAt },
  ];
}
