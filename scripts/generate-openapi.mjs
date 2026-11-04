import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { buildOpenApiDocument } from "./openapi-contract.mjs";

const target = join(process.cwd(), "public", "openapi.yaml");
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`, "utf8");
console.log(`OpenAPI contract generated at ${target}. JSON syntax is valid YAML 1.2.`);
