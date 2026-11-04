import { validateProductionEnvironment } from "./lib/production-config.mjs";

const result = validateProductionEnvironment(process.env);
if (!result.ok) {
  console.error("DeshDak production configuration rejected:");
  for (const error of result.errors) console.error(`- ${error}`);
  console.error("No secret values were printed. Correct the secret-manager configuration before starting production.");
  process.exit(1);
}

console.log("DeshDak production configuration passed the fail-closed startup gate.");
