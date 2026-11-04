import "server-only";

import { timingSafeEqual } from "node:crypto";

export function verifyMaintenanceJobSecret(request: Request) {
  const configured = process.env.MAINTENANCE_JOB_SECRET;
  if (!configured || configured.length < 32) return { configured: false, authorized: false };
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const expectedBuffer = Buffer.from(configured);
  const suppliedBuffer = Buffer.from(supplied);
  return { configured: true, authorized: expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer) };
}
