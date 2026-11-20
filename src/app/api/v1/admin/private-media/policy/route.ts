import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { createMediaLifecycle, mediaPolicyRequest } from "@/modules/private-storage/lifecycle";
import { privateMediaHeaders, privateMediaHttpAccess, privateMediaHttpError } from "@/modules/private-storage/lifecycle-http";
export async function POST(request: NextRequest) {
  const access = await privateMediaHttpAccess(request, true);
  if (access.error) return access.error;
  const body = mediaPolicyRequest.safeParse(access.body);
  if (!body.success) return apiError("VALIDATION_ERROR", "Complete the bounded form and confirmation before submitting.", 422);
  try { return apiSuccess(await createMediaLifecycle(prisma).savePolicy(access.session!.sessionId, body.data), { headers: privateMediaHeaders }); }
  catch (error) { return privateMediaHttpError(error); }
}
