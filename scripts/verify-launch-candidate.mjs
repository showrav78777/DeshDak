import { spawnSync } from "node:child_process";

const baseUrl = process.env.TEST_BASE_URL ?? process.env.APP_BASE_URL ?? "http://localhost:3000";
const skipBuild = process.argv.includes("--skip-build");
const isolatedSchema = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).searchParams.get("schema") : null;
const canInjectDatabaseFaults = /^crossly_launch_verify_[a-f0-9]{16}$/.test(isolatedSchema ?? "");
const checks = [
  "test:warehouse-receipt-policy",
  "test:supplier-order-records",
  "test:manual-purchase-review",
  "test:website-media-safety",
  "test:isolated-route-retention", "test:identifier-layout", "test:catalog-sorting",
  "test:source-settings-request", "test:source-readiness", "test:otapi-client", "test:supplier-candidate",
  "api:generate", "api:contract", "typecheck", "lint", "test:production-config", "test:operations-safety", "test:performance-policy", "test:security-regressions", "test:verification-cookie-portability", "test:dependency-integrity", "test:dependency-audit", "test:container-security", "db:migration:verify",
  "test:csrf-rules", "test:csrf-boundary", "test:admin-mfa", "test:auth-recovery", "test:session-management", "test:observability",
  ...(canInjectDatabaseFaults ? ["test:logout-atomicity", "test:website-media"] : []),
  "test:identifier-rules", "test:identifier-database", "test:identifier-assets", "test:identifier-workflow",
  "test:customer-account", "test:customer-markets", "test:anonymous-market", "test:catalog-market-ranking", "test:wishlist", "test:cart", "test:coupon-workflow", "test:automatic-promotions", "test:financial-rules", "test:sslcommerz-adapter", "test:payment-risk-review", "test:payment-reconciliation", "test:payment-reconciliation-resolution", "test:chargeback-posting", "test:refund-workflow", "test:original-method-refunds",
  ...(process.env.MAINTENANCE_JOB_SECRET ? ["test:security-cleanup", "test:payment-operations-monitor"] : []),
  "test:rich-catalog", "test:product-reviews", "test:reels", "test:sales-kam", "test:seller-store-revisions", "test:seller-product-revisions", "test:seller-catalog-imports", "test:seller-catalog-connections",
  "test:restricted-goods", "test:compliance-portal", "test:finance-portal", "test:sourcing-portal", "test:warehouse-portal", "test:inspector-portal", "test:logistics-portal",
  "test:ship-for-me", "test:rma-workflow", "test:support-workflow", "test:support-policy", "test:help-centre", "test:ai-chat-handoff",
  "test:public-rate-limit",
  "test:admin-shell", "test:admin-audit-log", "test:launch-readiness", "test:notification-preferences", "test:marketing-campaigns",
  ...(skipBuild ? [] : ["build"]),
];

try {
  const health = await fetch(new URL("/api/v1/health/live", baseUrl), { signal: AbortSignal.timeout(5_000) });
  if (!health.ok) throw new Error(`health returned ${health.status}`);
} catch (error) {
  console.error(`Launch verification requires a running app at ${baseUrl}: ${error instanceof Error ? error.message : "unavailable"}`);
  process.exit(1);
}

const startedAt = Date.now();
for (const [index, check] of checks.entries()) {
  console.log(`\n[${index + 1}/${checks.length}] npm run ${check}`);
  const result = spawnSync("npm", ["run", check], { cwd: process.cwd(), env: process.env, stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`\nLaunch verification stopped at ${check}. Fix this blocker before continuing.`);
    process.exit(result.status ?? 1);
  }
}

const minutes = ((Date.now() - startedAt) / 60_000).toFixed(1);
console.log(`\nLaunch-candidate verification passed ${checks.length} gates in ${minutes} minute(s).`);
if (!process.env.MAINTENANCE_JOB_SECRET) console.log("Scheduler-secret verification was not run because MAINTENANCE_JOB_SECRET is not configured in this environment.");
if (!canInjectDatabaseFaults) console.log("Logout database fault injection was not run outside a generated isolated schema. Use verify:launch:isolated for this gate.");
