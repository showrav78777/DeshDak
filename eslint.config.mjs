import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-crossly_launch_verify_*/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated verification artifacts are not application/test source.
    "playwright-report*/**",
    "test-results*/**",
    "blob-report/**",
    "all-blob-reports/**",
  ]),
]);

export default eslintConfig;
