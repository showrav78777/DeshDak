import { request, type FullConfig } from "@playwright/test";
import { access, rm } from "node:fs/promises";

export default async function teardown(config: FullConfig) {
  const errors: Error[] = [];
  for (const portal of ["customer", "warehouse", "inspector", "logistics", "support"]) {
  const state = `e2e/.auth/${portal}.json`;
  try { await access(state); } catch { continue; }
  const baseURL = config.projects[0].use.baseURL!;
  const context = await request.newContext({ baseURL, storageState: state });
  try {
    const response = await context.post("/api/v1/auth/logout", { headers: { Origin: baseURL } });
    if (!response.ok()) throw new Error(`Test session revocation failed (${response.status()}).`);
  } catch (error) { errors.push(error as Error); }
  finally { await context.dispose(); await rm(state, { force: true }); }
  }
  if (errors.length) throw new AggregateError(errors, "Test session cleanup failed.");
}
