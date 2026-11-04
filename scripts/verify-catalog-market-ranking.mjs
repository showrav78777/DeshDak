import { customerMarketLabel, normalizeMarketCountry, productMarketPriority } from "../src/modules/catalog/market-policy.ts";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(normalizeMarketCountry("bd") === "BD", "Bangladesh country normalization failed.");
assert(normalizeMarketCountry("us") === "US", "International country normalization failed.");
assert(normalizeMarketCountry("invalid") === "BD", "Invalid country must use the safe first-launch default.");
assert(productMarketPriority("CN", "BD") < productMarketPriority("BD", "BD"), "Bangladesh customers must receive global products before local products.");
assert(productMarketPriority("US", "US") < productMarketPriority("CN", "US"), "International customers must receive their local products before global products.");
assert(productMarketPriority("BD", "US") === productMarketPriority("CN", "US"), "Non-local origins must remain in the international customer's global cohort.");
assert(customerMarketLabel("BD") === "GLOBAL_FIRST", "Bangladesh ranking label is incorrect.");
assert(customerMarketLabel("GB") === "LOCAL_FIRST", "International ranking label is incorrect.");

console.log("Catalog market-ranking policy verification passed 8 controls.");
